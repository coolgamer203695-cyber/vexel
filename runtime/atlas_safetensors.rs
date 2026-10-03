// ===== Atlas v0.5: SafeTensors reader (read-only, honest) =====
// SafeTensors layout: u64 LE header_len | JSON header | tensor data.
// Header entries: { "<name>": { "dtype": "F32", "shape": [...],
//                               "data_offsets": [begin, end] } }
// Offsets are relative to the data region (byte 8 + header_len).
// Atlas reads F32 directly and converts F16/BF16 on the host; every
// other dtype is an honest unsupported-dtype error — never a guess.

const SAFETENSORS_HEADER_CAP: usize = 100 * 1024 * 1024; // 100 MiB
const SAFETENSORS_TENSOR_CAP: usize = 1_000_000;

#[derive(Clone, Debug, PartialEq)]
pub enum AtlasSafetensorDtype {
    F32,
    F16,
    BF16,
}

fn safetensors_dtype_size(d: &AtlasSafetensorDtype) -> usize {
    match d {
        AtlasSafetensorDtype::F32 => 4,
        AtlasSafetensorDtype::F16 | AtlasSafetensorDtype::BF16 => 2,
    }
}

fn safetensors_parse_dtype(s: &str) -> Result<AtlasSafetensorDtype, String> {
    match s {
        "F32" | "f32" => Ok(AtlasSafetensorDtype::F32),
        "F16" | "f16" => Ok(AtlasSafetensorDtype::F16),
        "BF16" | "bf16" => Ok(AtlasSafetensorDtype::BF16),
        other => Err(atlas_err("UnsupportedError", format!(
            "SafeTensors dtype '{}' is not supported by Atlas v0.5 (supported: F32, F16, BF16).",
            other
        ))),
    }
}

fn f16_to_f32(bits: u16) -> f32 {
    let sign = ((bits >> 15) & 1) as u32;
    let exp = ((bits >> 10) & 0x1F) as u32;
    let frac = (bits & 0x3FF) as u32;
    if exp == 0 {
        if frac == 0 {
            return if sign == 1 { -0.0 } else { 0.0 };
        }
        // Subnormal: normalize it.
        let mut e = 127 - 15 + 1;
        let mut f = frac;
        while f & 0x400 == 0 {
            f <<= 1;
            e -= 1;
        }
        f &= 0x3FF;
        return f32::from_bits((sign << 31) | ((e as u32) << 23) | (f << 13));
    }
    if exp == 31 {
        return f32::from_bits((sign << 31) | (0xFF << 23) | (frac << 13));
    }
    f32::from_bits((sign << 31) | ((exp + 127 - 15) << 23) | (frac << 13))
}

fn bf16_to_f32(bits: u16) -> f32 {
    f32::from_bits((bits as u32) << 16)
}

fn safetensors_bytes_to_f32(dtype: &AtlasSafetensorDtype, bytes: &[u8], _name: &str) -> Result<Vec<f32>, String> {
    match dtype {
        AtlasSafetensorDtype::F32 => {
            let mut vals = Vec::with_capacity(bytes.len() / 4);
            let mut i = 0;
            while i + 4 <= bytes.len() {
                vals.push(f32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]));
                i += 4;
            }
            Ok(vals)
        }
        AtlasSafetensorDtype::F16 => {
            let mut vals = Vec::with_capacity(bytes.len() / 2);
            let mut i = 0;
            while i + 2 <= bytes.len() {
                vals.push(f16_to_f32(u16::from_le_bytes([bytes[i], bytes[i + 1]])));
                i += 2;
            }
            Ok(vals)
        }
        AtlasSafetensorDtype::BF16 => {
            let mut vals = Vec::with_capacity(bytes.len() / 2);
            let mut i = 0;
            while i + 2 <= bytes.len() {
                vals.push(bf16_to_f32(u16::from_le_bytes([bytes[i], bytes[i + 1]])));
                i += 2;
            }
            Ok(vals)
        }
    }
}

fn safetensors_prod(shape: &[usize]) -> Option<u64> {
    let mut p: u64 = 1;
    for d in shape {
        p = p.checked_mul(*d as u64)?;
    }
    Some(p)
}

// Read one .safetensors file into (name, shape, f32 values).
// Bounds are validated before any slice is taken — a corrupt or
// hostile file produces an error, never a panic.
pub fn safetensors_read(path: &str) -> Result<Vec<(String, Vec<usize>, Vec<f32>)>, String> {
    let bytes = std::fs::read(path).map_err(|e| {
        atlas_err("RuntimeError", format!("Cannot read {}: {}", path, e))
    })?;
    if bytes.len() < 8 {
        return Err(atlas_err("FormatError", format!("{} is too small to be a SafeTensors file.", path)));
    }
    let header_len_u64 = u64::from_le_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5], bytes[6], bytes[7],
    ]);
    if header_len_u64 > SAFETENSORS_HEADER_CAP as u64 {
        return Err(atlas_err("FormatError", format!("{} header exceeds the size limit.", path)));
    }
    let header_len = header_len_u64 as usize;
    let header_end = 8usize.checked_add(header_len).ok_or_else(|| {
        atlas_err("FormatError", format!("{} header length overflows.", path))
    })?;
    if bytes.len() < header_end {
        return Err(atlas_err("FormatError", format!("{} is truncated (header cut short).", path)));
    }
    let header_text = std::str::from_utf8(&bytes[8..header_end]).map_err(|_| {
        atlas_err("FormatError", format!("{} header is not valid UTF-8.", path))
    })?;
    let header = vex_json_parse(header_text, path)?;
    let hrc = match &header {
        VexVal::Struct(rc) => rc.clone(),
        _ => return Err(atlas_err("FormatError", format!("{} header must be a JSON object.", path))),
    };
    let data_len = (bytes.len() - header_end) as u64;
    let mut out: Vec<(String, Vec<usize>, Vec<f32>)> = Vec::new();
    let hb = hrc.borrow();
    if hb.fields.len() > SAFETENSORS_TENSOR_CAP {
        return Err(atlas_err("FormatError", format!("{} declares too many tensors.", path)));
    }
    for (name, entry) in hb.fields.iter() {
        if name == "__metadata__" {
            continue; // informational string map, no tensor data
        }
        let er = match entry {
            VexVal::Struct(s) => s.clone(),
            _ => return Err(atlas_err("FormatError", format!("{}: tensor '{}' entry must be an object.", path, name))),
        };
        let eb = er.borrow();
        let dtype_s = match eb.fields.get("dtype") {
            Some(VexVal::Str(s)) => s.clone(),
            _ => return Err(atlas_err("FormatError", format!("{}: tensor '{}' is missing 'dtype'.", path, name))),
        };
        let dtype = safetensors_parse_dtype(&dtype_s)?;
        let shape_v = match eb.fields.get("shape") {
            Some(v) => v,
            None => return Err(atlas_err("FormatError", format!("{}: tensor '{}' is missing 'shape'.", path, name))),
        };
        let mut shape: Vec<usize> = Vec::new();
        match shape_v {
            VexVal::List(rc) => {
                let lb = rc.borrow();
                for d in lb.iter() {
                    match d {
                        VexVal::Int(i) if *i >= 0 => shape.push(*i as usize),
                        _ => return Err(atlas_err("FormatError", format!("{}: tensor '{}' has a bad shape.", path, name))),
                    }
                }
            }
            _ => return Err(atlas_err("FormatError", format!("{}: tensor '{}' shape must be a list.", path, name))),
        }
        let offsets_v = match eb.fields.get("data_offsets") {
            Some(v) => v,
            None => return Err(atlas_err("FormatError", format!("{}: tensor '{}' is missing 'data_offsets'.", path, name))),
        };
        let (begin, end) = match offsets_v {
            VexVal::List(rc) => {
                let lb = rc.borrow();
                if lb.len() != 2 {
                    return Err(atlas_err("FormatError", format!("{}: tensor '{}' needs two data offsets.", path, name)));
                }
                let num = |v: &VexVal| -> Result<u64, String> {
                    match v {
                        VexVal::Int(i) if *i >= 0 => Ok(*i as u64),
                        _ => Err(atlas_err("FormatError", format!("{}: tensor '{}' has bad data offsets.", path, name))),
                    }
                };
                (num(&lb[0])?, num(&lb[1])?)
            }
            _ => return Err(atlas_err("FormatError", format!("{}: tensor '{}' data_offsets must be a list.", path, name))),
        };
        if end < begin {
            return Err(atlas_err("FormatError", format!("{}: tensor '{}' offsets are inverted.", path, name)));
        }
        if end > data_len {
            return Err(atlas_err("FormatError", format!(
                "{}: tensor '{}' points outside the data region (end {}, size {}).",
                path, name, end, data_len
            )));
        }
        let want_bytes = safetensors_prod(&shape)
            .and_then(|p| p.checked_mul(safetensors_dtype_size(&dtype) as u64))
            .ok_or_else(|| atlas_err("ShapeError", format!("{}: tensor '{}' shape is too large.", path, name)))?;
        if want_bytes != end - begin {
            return Err(atlas_err("FormatError", format!(
                "{}: tensor '{}' shape {} needs {} bytes but its offsets span {}.",
                path, name, atlas_shape_str(&shape), want_bytes, end - begin
            )));
        }
        let s = header_end + begin as usize;
        let e = header_end + end as usize;
        let vals = safetensors_bytes_to_f32(&dtype, &bytes[s..e], name)?;
        out.push((name.clone(), shape, vals));
    }
    Ok(out)
}
