// ===== Atlas v0.5: native model.atlas binary container =====
// Little-endian throughout. Layout:
//   magic "ATLS" | u32 version | u32 flags | u32 tensor_count |
//   u64 header_len | header JSON | tensor data | u32 CRC32 (IEEE)
// The CRC covers every byte before the trailing checksum, so a
// truncated or corrupted file fails loudly instead of decoding into
// garbage. Every read is bounds-checked with checked arithmetic —
// a hostile file can never panic the runtime.

const ATLAS_BIN_MAGIC: [u8; 4] = *b"ATLS";
const ATLAS_BIN_VERSION: u32 = 1;
const ATLAS_BIN_HEADER_CAP: usize = 64 * 1024 * 1024; // 64 MiB header cap
const ATLAS_BIN_TENSOR_CAP: u32 = 1_000_000;

const fn atlas_crc32_table() -> [u32; 256] {
    let mut t = [0u32; 256];
    let mut i = 0usize;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        t[i] = c;
        i += 1;
    }
    t
}
static ATLAS_CRC32_TABLE: [u32; 256] = atlas_crc32_table();

// Standard CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320).
pub fn atlas_crc32(bytes: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &b in bytes {
        let idx = ((crc ^ (b as u32)) & 0xFF) as usize;
        crc = ATLAS_CRC32_TABLE[idx] ^ (crc >> 8);
    }
    !crc
}

fn atlas_json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn atlas_prod(shape: &[usize]) -> Option<usize> {
    let mut p: usize = 1;
    for d in shape {
        p = p.checked_mul(*d)?;
    }
    Some(p)
}

// Serialize tensors into a model.atlas byte stream. Deterministic:
// entries keep the caller's order (the canonical parameter order),
// so saving the same model twice produces identical bytes.
pub fn atlas_pack_model(tensors: &[(String, Vec<usize>, Vec<f32>)]) -> Result<Vec<u8>, String> {
    if tensors.len() as u64 > ATLAS_BIN_TENSOR_CAP as u64 {
        return Err(atlas_err("FormatError", format!(
            "Too many tensors for model.atlas ({}; limit {}).",
            tensors.len(), ATLAS_BIN_TENSOR_CAP
        )));
    }
    let mut data: Vec<u8> = Vec::new();
    let mut entries: Vec<String> = Vec::with_capacity(tensors.len());
    for (name, shape, vals) in tensors {
        let prod = atlas_prod(shape).ok_or_else(|| {
            atlas_err("ShapeError", format!("Tensor '{}' shape is too large to store.", name))
        })?;
        if prod != vals.len() {
            return Err(atlas_err("ShapeError", format!(
                "Tensor '{}' shape {} cannot hold {} values (expected {}).",
                name, atlas_shape_str(shape), vals.len(), prod
            )));
        }
        let offset = data.len() as u64;
        for v in vals {
            data.extend_from_slice(&v.to_le_bytes());
        }
        let nbytes = (vals.len() as u64).saturating_mul(4);
        let dims: Vec<String> = shape.iter().map(|d| d.to_string()).collect();
        entries.push(format!(
            "\"{}\":{{\"shape\":[{}],\"offset\":{},\"nbytes\":{},\"dtype\":\"f32\"}}",
            atlas_json_escape(name),
            dims.join(","),
            offset,
            nbytes
        ));
    }
    let header = format!("{{\"tensors\":{{{}}}}}", entries.join(","));
    let header_bytes = header.as_bytes();
    if header_bytes.len() > ATLAS_BIN_HEADER_CAP {
        return Err(atlas_err("FormatError", "model.atlas header is too large.".to_string()));
    }
    let mut out: Vec<u8> = Vec::with_capacity(24 + header_bytes.len() + data.len() + 4);
    out.extend_from_slice(&ATLAS_BIN_MAGIC);
    out.extend_from_slice(&ATLAS_BIN_VERSION.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // flags
    out.extend_from_slice(&(tensors.len() as u32).to_le_bytes());
    out.extend_from_slice(&(header_bytes.len() as u64).to_le_bytes());
    out.extend_from_slice(header_bytes);
    out.extend_from_slice(&data);
    let crc = atlas_crc32(&out);
    out.extend_from_slice(&crc.to_le_bytes());
    Ok(out)
}

fn atlas_hdr_u64(v: &VexVal) -> Result<u64, String> {
    match v {
        VexVal::Int(i) if *i >= 0 => Ok(*i as u64),
        VexVal::Int(i) => Err(atlas_err("FormatError", format!("model.atlas header has a negative number ({}).", i))),
        _ => Err(atlas_err("FormatError", format!("model.atlas header expected a number, got {}.", v.type_name()))),
    }
}

// Parse a model.atlas byte stream back into tensors. Never panics:
// every offset is validated against the real buffer before reading.
pub fn atlas_unpack_model(bytes: &[u8]) -> Result<Vec<(String, Vec<usize>, Vec<f32>)>, String> {
    const PREFIX: usize = 4 + 4 + 4 + 4 + 8; // magic + version + flags + count + header_len
    if bytes.len() < PREFIX + 4 {
        return Err(atlas_err("FormatError", "model.atlas is truncated (too small to be a model file).".to_string()));
    }
    if bytes[0..4] != ATLAS_BIN_MAGIC {
        return Err(atlas_err("FormatError", "Not an Atlas model file: bad magic (expected ATLS).".to_string()));
    }
    let version = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    if version != ATLAS_BIN_VERSION {
        if version > ATLAS_BIN_VERSION {
            return Err(atlas_err("FormatError", format!(
                "model.atlas was written by a newer Atlas (format version {}); this build reads version {}.",
                version, ATLAS_BIN_VERSION
            )));
        }
        return Err(atlas_err("FormatError", format!("model.atlas has unknown format version {}.", version)));
    }
    let flags = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    if flags != 0 {
        return Err(atlas_err("FormatError", format!("model.atlas uses unknown feature flags ({}).", flags)));
    }
    let tensor_count = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]);
    if tensor_count > ATLAS_BIN_TENSOR_CAP {
        return Err(atlas_err("FormatError", format!(
            "model.atlas declares {} tensors (limit {}).",
            tensor_count, ATLAS_BIN_TENSOR_CAP
        )));
    }
    let header_len_u64 = u64::from_le_bytes([
        bytes[16], bytes[17], bytes[18], bytes[19],
        bytes[20], bytes[21], bytes[22], bytes[23],
    ]);
    if header_len_u64 > ATLAS_BIN_HEADER_CAP as u64 {
        return Err(atlas_err("FormatError", "model.atlas header exceeds the size limit.".to_string()));
    }
    let header_len = header_len_u64 as usize;
    // Layout: prefix | header | data | crc32
    let body_end = PREFIX
        .checked_add(header_len)
        .and_then(|p| p.checked_add(4))
        .ok_or_else(|| atlas_err("FormatError", "model.atlas sizes overflow.".to_string()))?;
    if bytes.len() < body_end {
        return Err(atlas_err("FormatError", "model.atlas is truncated (header/checksum cut short).".to_string()));
    }
    let data_start = PREFIX + header_len;
    let data_end = bytes.len() - 4;
    if data_end < data_start {
        return Err(atlas_err("FormatError", "model.atlas is truncated (data region cut short).".to_string()));
    }
    // Checksum first: a corrupted file never reaches the JSON parser.
    let stored_crc = u32::from_le_bytes([
        bytes[data_end], bytes[data_end + 1], bytes[data_end + 2], bytes[data_end + 3],
    ]);
    let actual_crc = atlas_crc32(&bytes[..data_end]);
    if stored_crc != actual_crc {
        return Err(atlas_err("FormatError", "model.atlas failed its checksum (the file is corrupted).".to_string()));
    }
    let header_text = std::str::from_utf8(&bytes[PREFIX..data_start])
        .map_err(|_| atlas_err("FormatError", "model.atlas header is not valid UTF-8.".to_string()))?;
    let header = vex_json_parse(header_text, "model.atlas header")?;
    let hrc = match &header {
        VexVal::Struct(rc) => rc.clone(),
        _ => return Err(atlas_err("FormatError", "model.atlas header must be a JSON object.".to_string())),
    };
    let tensors_field = {
        let hb = hrc.borrow();
        match hb.fields.get("tensors") {
            Some(VexVal::Struct(t)) => t.clone(),
            _ => return Err(atlas_err("FormatError", "model.atlas header is missing 'tensors'.".to_string())),
        }
    };
    let mut out: Vec<(String, Vec<usize>, Vec<f32>)> = Vec::new();
    {
        let tb = tensors_field.borrow();
        if tb.fields.len() as u32 != tensor_count {
            return Err(atlas_err("FormatError", format!(
                "model.atlas header lists {} tensors but the file declares {}.",
                tb.fields.len(), tensor_count
            )));
        }
        for (name, entry) in tb.fields.iter() {
            let er = match entry {
                VexVal::Struct(s) => s.clone(),
                _ => return Err(atlas_err("FormatError", format!("Tensor '{}' entry must be a JSON object.", name))),
            };
            let eb = er.borrow();
            let shape_v = eb.fields.get("shape").ok_or_else(|| {
                atlas_err("FormatError", format!("Tensor '{}' is missing 'shape'.", name))
            })?;
            let mut shape: Vec<usize> = Vec::new();
            match shape_v {
                VexVal::List(rc) => {
                    let lb = rc.borrow();
                    for d in lb.iter() {
                        match d {
                            VexVal::Int(i) if *i >= 0 => shape.push(*i as usize),
                            _ => return Err(atlas_err("FormatError", format!("Tensor '{}' has a bad shape entry.", name))),
                        }
                    }
                }
                _ => return Err(atlas_err("FormatError", format!("Tensor '{}' shape must be a list.", name))),
            }
            let dtype = match eb.fields.get("dtype") {
                Some(VexVal::Str(s)) => s.clone(),
                _ => return Err(atlas_err("FormatError", format!("Tensor '{}' is missing 'dtype'.", name))),
            };
            if dtype != "f32" {
                return Err(atlas_err("FormatError", format!(
                    "Tensor '{}' has dtype '{}' but model.atlas stores float32 only.",
                    name, dtype
                )));
            }
            let offset = atlas_hdr_u64(eb.fields.get("offset").ok_or_else(|| {
                atlas_err("FormatError", format!("Tensor '{}' is missing 'offset'.", name))
            })?)?;
            let nbytes = atlas_hdr_u64(eb.fields.get("nbytes").ok_or_else(|| {
                atlas_err("FormatError", format!("Tensor '{}' is missing 'nbytes'.", name))
            })?)?;
            if nbytes % 4 != 0 {
                return Err(atlas_err("FormatError", format!("Tensor '{}' byte length is not a multiple of 4.", name)));
            }
            let count = nbytes / 4;
            let prod = atlas_prod(&shape).ok_or_else(|| {
                atlas_err("ShapeError", format!("Tensor '{}' shape is too large.", name))
            })? as u64;
            if prod != count {
                return Err(atlas_err("FormatError", format!(
                    "Tensor '{}' shape {} needs {} values but the header says {}.",
                    name, atlas_shape_str(&shape), prod, count
                )));
            }
            let data_len = (data_end - data_start) as u64;
            let end = offset.checked_add(nbytes).ok_or_else(|| {
                atlas_err("FormatError", format!("Tensor '{}' offsets overflow.", name))
            })?;
            if end > data_len {
                return Err(atlas_err("FormatError", format!(
                    "Tensor '{}' points outside the data region (end {}, size {}).",
                    name, end, data_len
                )));
            }
            let base = data_start + offset as usize;
            let mut vals = Vec::with_capacity(count as usize);
            let mut i = 0usize;
            while i < nbytes as usize {
                let s = base + i;
                vals.push(f32::from_le_bytes([bytes[s], bytes[s + 1], bytes[s + 2], bytes[s + 3]]));
                i += 4;
            }
            out.push((name.clone(), shape, vals));
        }
    }
    Ok(out)
}
