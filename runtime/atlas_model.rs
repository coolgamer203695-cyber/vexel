// ===== Atlas v0.5: pretrained Model objects (create/load/save/forward) =====
// A Model is a VexStruct with type_name "Model" and four real fields:
//   config          — the normalized config object (format/arch/layers)
//   mode            — "train" or "eval"
//   parameters      — flat list of parameter tensors, canonical order
//   path            — folder it was loaded from/saved to ("" until saved)
// Canonical parameter order: linear -> [w, b] ; mlp -> per layer [w, b].
// The parameters list is the SAME shared list `m.parameters` returns,
// so `m.parameters[0] = ...` write-backs are seen by forward.

pub struct AtlasLayerCfg {
    pub in_dim: usize,
    pub out_dim: usize,
    pub activation: String,
}

pub struct AtlasModelCfg {
    pub name: String,
    pub arch: String, // "linear" | "mlp"
    pub layers: Vec<AtlasLayerCfg>,
}

const ATLAS_MODEL_FORMAT: &str = "atlas-model";
const ATLAS_MODEL_FORMAT_VERSION: i64 = 1;

fn cfg_activation_ok(a: &str) -> bool {
    matches!(a, "none" | "relu" | "sigmoid" | "tanh")
}

fn cfg_int(v: Option<&VexVal>, field: &str, where_desc: &str) -> Result<i64, String> {
    match v {
        Some(VexVal::Int(i)) => Ok(*i),
        Some(other) => Err(atlas_err("ValueError", format!(
            "Config field '{}' must be an integer, got {} ({}) .", field, other.type_name(), where_desc
        ))),
        None => Err(atlas_err("ValueError", format!(
            "Config is missing required field '{}' ({}).", field, where_desc
        ))),
    }
}

// Validate a config object (from config.json, json read, or an object
// literal) and return the normalized config plus its canonical form.
pub fn atlas_config_parse(v: &VexVal, where_desc: &str) -> Result<(AtlasModelCfg, VexVal), String> {
    if atlas_config_is_hf(v) {
        return Err(atlas_hf_unsupported(atlas_hf_arch_name(v), &format!("The config {}", where_desc)));
    }
    let rc = match v {
        VexVal::Struct(s) => s.clone(),
        _ => return Err(atlas_err("TypeError", format!(
            "A model config must be an object, got {} ({}).", v.type_name(), where_desc
        ))),
    };
    let (format, format_version, name, arch, layers_v) = {
        let b = rc.borrow();
        let format = match b.fields.get("format") {
            Some(VexVal::Str(s)) => Some(s.clone()),
            Some(other) => return Err(atlas_err("ValueError", format!(
                "Config field 'format' must be a string, got {} ({}).", other.type_name(), where_desc
            ))),
            None => None,
        };
        let format_version = b.fields.get("format_version").cloned();
        let name = match b.fields.get("name") {
            Some(VexVal::Str(s)) => s.clone(),
            Some(other) => return Err(atlas_err("ValueError", format!(
                "Config field 'name' must be a string, got {} ({}).", other.type_name(), where_desc
            ))),
            None => String::from("model"),
        };
        let arch = match b.fields.get("arch") {
            Some(VexVal::Str(s)) => s.clone(),
            Some(other) => return Err(atlas_err("ValueError", format!(
                "Config field 'arch' must be a string, got {} ({}).", other.type_name(), where_desc
            ))),
            None => return Err(atlas_err("ValueError", format!(
                "Config is missing required field 'arch' ({}). Supported architectures: linear, mlp.", where_desc
            ))),
        };
        let layers_v = b.fields.get("layers").cloned();
        (format, format_version, name, arch, layers_v)
    };
    match format.as_deref() {
        Some(ATLAS_MODEL_FORMAT) => {}
        Some(other) => return Err(atlas_err("ValueError", format!(
            "Config format '{}' is not an Atlas model config (expected '{}') ({}).",
            other, ATLAS_MODEL_FORMAT, where_desc
        ))),
        None => return Err(atlas_err("ValueError", format!(
            "Config is missing required field 'format' (expected \"{}\") ({}).",
            ATLAS_MODEL_FORMAT, where_desc
        ))),
    }
    let version = match &format_version {
        Some(VexVal::Int(i)) => *i,
        Some(other) => return Err(atlas_err("ValueError", format!(
            "Config field 'format_version' must be an integer, got {} ({}).", other.type_name(), where_desc
        ))),
        None => return Err(atlas_err("ValueError", format!(
            "Config is missing required field 'format_version' ({}).", where_desc
        ))),
    };
    if version > ATLAS_MODEL_FORMAT_VERSION {
        return Err(atlas_err("UnsupportedError", format!(
            "This model was saved by a newer Atlas (format_version {}); Atlas v0.5 reads format_version {} ({}).",
            version, ATLAS_MODEL_FORMAT_VERSION, where_desc
        )));
    }
    if version != ATLAS_MODEL_FORMAT_VERSION {
        return Err(atlas_err("ValueError", format!(
            "Config format_version {} is not supported (Atlas v0.5 reads {}) ({}).",
            version, ATLAS_MODEL_FORMAT_VERSION, where_desc
        )));
    }
    if arch != "linear" && arch != "mlp" {
        return Err(atlas_err("ValueError", format!(
            "Architecture '{}' is not supported by Atlas v0.5 (supported: linear, mlp) ({}).", arch, where_desc
        )));
    }
    let layers_lv = match &layers_v {
        Some(VexVal::List(l)) => l.clone(),
        Some(other) => return Err(atlas_err("ValueError", format!(
            "Config field 'layers' must be a list, got {} ({}).", other.type_name(), where_desc
        ))),
        None => return Err(atlas_err("ValueError", format!(
            "Config is missing required field 'layers' ({}).", where_desc
        ))),
    };
    let mut layers: Vec<AtlasLayerCfg> = Vec::new();
    let mut norm_layers: Vec<VexVal> = Vec::new();
    {
        let lb = layers_lv.borrow();
        if lb.is_empty() {
            return Err(atlas_err("ValueError", format!("Config 'layers' must not be empty ({}).", where_desc)));
        }
        for (i, lv) in lb.iter().enumerate() {
            let lrc = match lv {
                VexVal::Struct(s) => s.clone(),
                _ => return Err(atlas_err("ValueError", format!(
                    "Layer {} must be an object with 'in', 'out' and 'activation' ({}).", i, where_desc
                ))),
            };
            let (in_dim, out_dim, activation) = {
                let b = lrc.borrow();
                let in_dim = cfg_int(b.fields.get("in"), "in", &format!("layer {} {}", i, where_desc))?;
                let out_dim = cfg_int(b.fields.get("out"), "out", &format!("layer {} {}", i, where_desc))?;
                let activation = match b.fields.get("activation") {
                    Some(VexVal::Str(s)) => s.clone(),
                    Some(other) => return Err(atlas_err("ValueError", format!(
                        "Layer {} field 'activation' must be a string, got {} ({}).", i, other.type_name(), where_desc
                    ))),
                    None => String::from("none"),
                };
                (in_dim, out_dim, activation)
            };
            if in_dim <= 0 || out_dim <= 0 {
                return Err(atlas_err("ValueError", format!(
                    "Layer {} needs positive 'in'/'out' sizes (got in={}, out={}) ({}).", i, in_dim, out_dim, where_desc
                )));
            }
            if !cfg_activation_ok(&activation) {
                return Err(atlas_err("ValueError", format!(
                    "Layer {} activation '{}' is not supported (supported: none, relu, sigmoid, tanh) ({}).",
                    i, activation, where_desc
                )));
            }
            if i > 0 && layers[i - 1].out_dim as i64 != in_dim {
                return Err(atlas_err("ValueError", format!(
                    "Layer sizes do not chain: layer {} outputs {} but layer {} expects input {} ({}).",
                    i - 1, layers[i - 1].out_dim, i, in_dim, where_desc
                )));
            }
            let norm_layer = vex_struct_new("", vec![
                ("in".to_string(), VexVal::Int(in_dim)),
                ("out".to_string(), VexVal::Int(out_dim)),
                ("activation".to_string(), VexVal::Str(activation.clone())),
            ]);
            norm_layers.push(norm_layer);
            layers.push(AtlasLayerCfg { in_dim: in_dim as usize, out_dim: out_dim as usize, activation });
        }
    }
    if arch == "linear" && layers.len() != 1 {
        return Err(atlas_err("ValueError", format!(
            "Architecture 'linear' takes exactly one layer, got {} ({}). Use 'mlp' for deeper stacks.", layers.len(), where_desc
        )));
    }
    let name = if name.trim().is_empty() { String::from("model") } else { name };
    let cfg = AtlasModelCfg { name, arch, layers };
    let norm = vex_struct_new("", vec![
        ("format".to_string(), VexVal::Str(String::from(ATLAS_MODEL_FORMAT))),
        ("format_version".to_string(), VexVal::Int(ATLAS_MODEL_FORMAT_VERSION)),
        ("name".to_string(), VexVal::Str(cfg.name.clone())),
        ("arch".to_string(), VexVal::Str(cfg.arch.clone())),
        ("layers".to_string(), VexVal::List(Rc::new(RefCell::new(norm_layers)))),
    ]);
    Ok((cfg, norm))
}

// Canonical parameter layout: (name, shape) in list order.
pub fn atlas_cfg_params(cfg: &AtlasModelCfg) -> Vec<(String, Vec<usize>)> {
    let mut out: Vec<(String, Vec<usize>)> = Vec::new();
    if cfg.arch == "linear" {
        let l = &cfg.layers[0];
        out.push((String::from("w"), vec![l.in_dim, l.out_dim]));
        out.push((String::from("b"), vec![1, l.out_dim]));
    } else {
        for (i, l) in cfg.layers.iter().enumerate() {
            out.push((format!("layers.{}.w", i), vec![l.in_dim, l.out_dim]));
            out.push((format!("layers.{}.b", i), vec![1, l.out_dim]));
        }
    }
    out
}

pub fn atlas_cfg_param_count(cfg: &AtlasModelCfg) -> i64 {
    let mut total: i64 = 0;
    for l in cfg.layers.iter() {
        total += (l.in_dim * l.out_dim) as i64 + l.out_dim as i64;
    }
    total
}

fn atlas_cfg_of(model: &Rc<RefCell<VexStruct>>, where_desc: &str) -> Result<AtlasModelCfg, String> {
    let cfg_v = {
        let b = model.borrow();
        b.fields.get("config").cloned().ok_or_else(|| {
            atlas_err("ValueError", format!("This Model has no config field ({}).", where_desc))
        })?
    };
    let (cfg, _) = atlas_config_parse(&cfg_v, where_desc)?;
    Ok(cfg)
}

fn model_rc(v: &VexVal, what: &str) -> Result<Rc<RefCell<VexStruct>>, String> {
    match v {
        VexVal::Struct(rc) => {
            let is_model = rc.borrow().type_name == "Model";
            if is_model { Ok(rc.clone()) } else {
                Err(atlas_err("TypeError", format!(
                    "{} needs a Model value, got {} '{}'.", what, v.type_name(), rc.borrow().type_name
                )))
            }
        }
        _ => Err(atlas_err("TypeError", format!("{} needs a Model value, got {}.", what, v.type_name()))),
    }
}

fn model_params(model: &Rc<RefCell<VexStruct>>) -> Result<Rc<RefCell<Vec<VexVal>>>, String> {
    let p = model.borrow().fields.get("parameters").cloned();
    match p {
        Some(VexVal::List(rc)) => Ok(rc),
        _ => Err(atlas_err("ValueError", "This Model has no parameters list.".to_string())),
    }
}

fn model_mode(model: &Rc<RefCell<VexStruct>>) -> String {
    match model.borrow().fields.get("mode") {
        Some(VexVal::Str(s)) => s.clone(),
        _ => String::from("train"),
    }
}

fn model_build(config: VexVal, params: Vec<VexVal>, mode: &str, path: &str) -> VexVal {
    let mut fields = HashMap::new();
    fields.insert(String::from("config"), config);
    fields.insert(String::from("mode"), VexVal::Str(String::from(mode)));
    fields.insert(String::from("parameters"), VexVal::List(Rc::new(RefCell::new(params))));
    fields.insert(String::from("path"), VexVal::Str(String::from(path)));
    VexVal::Struct(Rc::new(RefCell::new(VexStruct { type_name: String::from("Model"), fields })))
}

// Deterministic uniform [0,1) via the fixed-seed Atlas stream (same
// source `random tensor` uses), so `create model` is reproducible.
fn atlas_model_random(shape: Vec<usize>) -> VexVal {
    let n: usize = shape.iter().product();
    let mut data = Vec::with_capacity(n);
    for _ in 0..n {
        let bits = (atlas_rand_next() >> 40) as u32;
        data.push(bits as f32 / 16777216.0);
    }
    VexVal::Tensor(VexTensor::contiguous_new(data, shape))
}

fn atlas_model_zeros(shape: Vec<usize>) -> VexVal {
    let n: usize = shape.iter().product();
    VexVal::Tensor(VexTensor::contiguous_new(vec![0.0f32; n], shape))
}

fn weights_find<'a>(weights: &'a [(String, Vec<usize>, Vec<f32>)], name: &str) -> Option<&'a (String, Vec<usize>, Vec<f32>)> {
    weights.iter().find(|(n, _, _)| n == name)
}

fn weights_fetch(weights: &[(String, Vec<usize>, Vec<f32>)], name: &str, shape: &[usize]) -> Result<VexVal, String> {
    let entry = weights_find(weights, name).ok_or_else(|| {
        atlas_err("ValueError", format!(
            "Weights are missing '{}' (expected shape {}) — this folder does not match its config.json.",
            name, atlas_shape_str(shape)
        ))
    })?;
    if entry.1.as_slice() != shape {
        return Err(atlas_err("ValueError", format!(
            "Weight '{}' has shape {} but the config expects {}.",
            name, atlas_shape_str(&entry.1), atlas_shape_str(shape)
        )));
    }
    Ok(VexVal::Tensor(VexTensor::contiguous_new(entry.2.clone(), entry.1.clone())))
}

fn atlas_weight_files_present(dir: &str) -> bool {
    ["model.atlas", "model.safetensors", "model.safetensors.index.json"].iter().any(|f| {
        std::path::Path::new(dir).join(f).exists()
    })
}

fn safetensors_shard_name_ok(shard: &str) -> bool {
    if shard.is_empty() || shard.contains("..") || shard.contains('\\') || shard.starts_with('/') {
        return false;
    }
    !shard.contains(':')
}

// Weight priority: model.atlas > sharded safetensors (index.json) >
// single model.safetensors. Every source is validated; a missing or
// mismatched tensor fails with the name it could not find.
fn model_read_weights(dir: &str) -> Result<Vec<(String, Vec<usize>, Vec<f32>)>, String> {
    let native = std::path::Path::new(dir).join("model.atlas");
    if native.exists() {
        let bytes = std::fs::read(&native).map_err(|e| atlas_err("RuntimeError", format!("Cannot read {}: {}", native.display(), e)))?;
        return atlas_unpack_model(&bytes);
    }
    let index_path = std::path::Path::new(dir).join("model.safetensors.index.json");
    if index_path.exists() {
        let text = std::fs::read_to_string(&index_path).map_err(|e| atlas_err("RuntimeError", format!("Cannot read {}: {}", index_path.display(), e)))?;
        let idx = vex_json_parse(&text, &index_path.display().to_string())?;
        let map_v = match &idx {
            VexVal::Struct(rc) => rc.borrow().fields.get("weight_map").cloned(),
            _ => None,
        };
        let map_rc = match map_v {
            Some(VexVal::Struct(rc)) => rc,
            _ => return Err(atlas_err("FormatError", format!("{} has no 'weight_map' object.", index_path.display()))),
        };
        let mut shards: Vec<String> = Vec::new();
        {
            let mb = map_rc.borrow();
            for (_, shard_v) in mb.fields.iter() {
                match shard_v {
                    VexVal::Str(s) => {
                        if !safetensors_shard_name_ok(s) {
                            return Err(atlas_err("FormatError", format!("{} names an unsafe shard path '{}'.", index_path.display(), s)));
                        }
                        if !shards.contains(s) { shards.push(s.clone()); }
                    }
                    _ => return Err(atlas_err("FormatError", format!("{} weight_map values must be strings.", index_path.display()))),
                }
            }
        }
        shards.sort();
        if shards.is_empty() {
            return Err(atlas_err("FormatError", format!("{} lists no shards.", index_path.display())));
        }
        let mut merged: Vec<(String, Vec<usize>, Vec<f32>)> = Vec::new();
        for shard in shards.iter() {
            let sp = std::path::Path::new(dir).join(shard);
            let tensors = safetensors_read(&sp.display().to_string())?;
            for t in tensors {
                if merged.iter().any(|(n, _, _)| *n == t.0) {
                    return Err(atlas_err("FormatError", format!("Tensor '{}' appears in more than one shard.", t.0)));
                }
                merged.push(t);
            }
        }
        return Ok(merged);
    }
    let single = std::path::Path::new(dir).join("model.safetensors");
    if single.exists() {
        return safetensors_read(&single.display().to_string());
    }
    Err(atlas_err("RuntimeError", format!(
        "No weights found in '{}': expected model.atlas, model.safetensors, or model.safetensors.index.json.",
        dir
    )))
}

fn info_struct(path: &str, cfg: &AtlasModelCfg, version: i64, weights_present: bool) -> VexVal {
    vex_struct_new("", vec![
        (String::from("path"), VexVal::Str(String::from(path))),
        (String::from("name"), VexVal::Str(cfg.name.clone())),
        (String::from("arch"), VexVal::Str(cfg.arch.clone())),
        (String::from("layers"), VexVal::Int(cfg.layers.len() as i64)),
        (String::from("parameters"), VexVal::Int(atlas_cfg_param_count(cfg))),
        (String::from("weights"), VexVal::Bool(weights_present)),
        (String::from("format_version"), VexVal::Int(version)),
    ])
}

fn config_version(cfg_v: &VexVal) -> i64 {
    match cfg_v {
        VexVal::Struct(rc) => match rc.borrow().fields.get("format_version") {
            Some(VexVal::Int(i)) => *i,
            _ => ATLAS_MODEL_FORMAT_VERSION,
        },
        _ => ATLAS_MODEL_FORMAT_VERSION,
    }
}

// Shared directory checks for load/info: missing folders, files, hub
// repo ids and Hugging Face configs all get their own honest message.
fn model_dir_and_config(path: &str) -> Result<(String, VexVal, AtlasModelCfg, VexVal), String> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        if atlas_looks_like_repo_id(path) {
            return Err(atlas_hub_unsupported(path));
        }
        return Err(atlas_err("RuntimeError", format!("Not an Atlas model folder: '{}' does not exist.", path)));
    }
    if !p.is_dir() {
        return Err(atlas_err("RuntimeError", format!(
            "load model expects a folder, but '{}' is a file. Point at the folder that contains config.json.",
            path
        )));
    }
    let config_path = p.join("config.json");
    let text = std::fs::read_to_string(&config_path).map_err(|_| {
        atlas_err("RuntimeError", format!("Not an Atlas model folder: '{}' is missing config.json.", path))
    })?;
    let v = vex_json_parse(&text, &config_path.display().to_string())?;
    let (cfg, norm) = atlas_config_parse(&v, &format!("in '{}/config.json'", path))?;
    Ok((String::from(path), v, cfg, norm))
}

// load model "<dir>" — config first, then weights by priority. The
// result starts in eval mode with gradients off (pure inference).
pub fn vex_model_load(path: &str) -> Result<VexVal, String> {
    let (dir, _raw, cfg, norm) = model_dir_and_config(path)?;
    let weights = model_read_weights(&dir)?;
    let layout = atlas_cfg_params(&cfg);
    let mut params: Vec<VexVal> = Vec::with_capacity(layout.len());
    for (name, shape) in layout.iter() {
        params.push(weights_fetch(&weights, name, shape)?);
    }
    Ok(model_build(norm, params, "eval", &dir))
}

// create model <config> — a fresh, deterministically initialized model
// in train mode (weights uniform [0,1), biases zero, gradients on).
pub fn vex_model_create(config: &VexVal) -> Result<VexVal, String> {
    if let VexVal::Str(s) = config {
        return Err(atlas_err("TypeError", format!(
            "create model takes a config object, not a path ('{}'). Build one with atlas.default_config 4, 8, 2 or json read \"config.json\"; to load saved weights use load model \"{}\".",
            s, s
        )));
    }
    let (cfg, norm) = atlas_config_parse(config, "passed to create model")?;
    let layout = atlas_cfg_params(&cfg);
    let mut params: Vec<VexVal> = Vec::with_capacity(layout.len());
    for (_, shape) in layout.iter() {
        let is_bias = shape.len() == 2 && shape[0] == 1;
        let t = if is_bias { atlas_model_zeros(shape.clone()) } else { atlas_model_random(shape.clone()) };
        if let VexVal::Tensor(rc) = &t {
            rc.borrow_mut().requires_grad = true;
        }
        params.push(t);
    }
    Ok(model_build(norm, params, "train", ""))
}

fn atlas_write_atomic(path_str: &str, bytes: &[u8]) -> Result<(), String> {
    let path = std::path::Path::new(path_str);
    let tmp_str = format!("{}.tmp", path_str);
    std::fs::write(&tmp_str, bytes).map_err(|e| atlas_err("RuntimeError", format!("Cannot write {}: {}", tmp_str, e)))?;
    if let Err(e) = std::fs::rename(&tmp_str, path) {
        let _ = std::fs::remove_file(&tmp_str);
        return Err(atlas_err("RuntimeError", format!("Cannot replace {}: {}", path_str, e)));
    }
    Ok(())
}

// save model <m> to "<dir>" — atomic per file (.tmp then rename), so a
// failed save never leaves a half-written model. Re-validates the
// config and parameter layout first; success records the new path.
pub fn vex_model_save(model: &VexVal, path: &str) -> Result<(), String> {
    let rc = model_rc(model, "save model")?;
    let (config_v, params_rc) = {
        let b = rc.borrow();
        let c = b.fields.get("config").cloned().ok_or_else(|| atlas_err("ValueError", "This Model has no config field.".to_string()))?;
        let p = b.fields.get("parameters").cloned();
        (c, p)
    };
    let params_rc = match params_rc {
        Some(VexVal::List(l)) => l,
        _ => return Err(atlas_err("ValueError", "This Model has no parameters list.".to_string())),
    };
    let (cfg, norm) = atlas_config_parse(&config_v, &format!("of the model saved to '{}'", path))?;
    let layout = atlas_cfg_params(&cfg);
    let tensors: Vec<(String, Vec<usize>, Vec<f32>)> = {
        let pb = params_rc.borrow();
        if pb.len() != layout.len() {
            return Err(atlas_err("ValueError", format!(
                "Model has {} parameters but its config describes {} — the parameters list was modified.",
                pb.len(), layout.len()
            )));
        }
        let mut out = Vec::with_capacity(layout.len());
        for (i, (name, shape)) in layout.iter().enumerate() {
            match &pb[i] {
                VexVal::Tensor(t) => {
                    let vals = t.borrow().to_cpu_vec()?;
                    if vals.len() != shape.iter().product::<usize>() {
                        return Err(atlas_err("ValueError", format!(
                            "Parameter '{}' holds {} values but its shape {} needs {}.",
                            name, vals.len(), atlas_shape_str(shape), shape.iter().product::<usize>()
                        )));
                    }
                    out.push((name.clone(), shape.clone(), vals));
                }
                other => return Err(atlas_err("ValueError", format!(
                    "Parameter '{}' must be a tensor, got {}.", name, other.type_name()
                ))),
            }
        }
        out
    };
    let packed = atlas_pack_model(&tensors)?;
    let config_json = vex_json_stringify(&norm)?;
    let meta = vex_struct_new("", vec![
        (String::from("format"), VexVal::Str(String::from("atlas-metadata"))),
        (String::from("format_version"), VexVal::Int(ATLAS_MODEL_FORMAT_VERSION)),
        (String::from("name"), VexVal::Str(cfg.name.clone())),
        (String::from("arch"), VexVal::Str(cfg.arch.clone())),
        (String::from("parameters"), VexVal::Int(atlas_cfg_param_count(&cfg))),
    ]);
    let meta_json = vex_json_stringify(&meta)?;
    std::fs::create_dir_all(path).map_err(|e| atlas_err("RuntimeError", format!("Cannot create folder '{}': {}", path, e)))?;
    atlas_write_atomic(&std::path::Path::new(path).join("config.json").display().to_string(), config_json.as_bytes())?;
    atlas_write_atomic(&std::path::Path::new(path).join("model.atlas").display().to_string(), &packed)?;
    atlas_write_atomic(&std::path::Path::new(path).join("metadata.json").display().to_string(), meta_json.as_bytes())?;
    rc.borrow_mut().fields.insert(String::from("path"), VexVal::Str(String::from(path)));
    Ok(())
}

// model info "<dir>" — config-only inspection: never reads weights,
// so a folder with a good config reports weights:false instead of
// failing, and an HF config still gets the unsupported-arch error.
pub fn vex_model_info(path: &str) -> Result<VexVal, String> {
    let (dir, _raw, cfg, norm) = model_dir_and_config(path)?;
    Ok(info_struct(&dir, &cfg, config_version(&norm), atlas_weight_files_present(&dir)))
}

// Row-broadcast bias add: x is [m, n], b is [1, n] or [n]. Result is
// x + broadcast(b) on x's device, tracked as AddBias so backward gives
// bias the row-summed gradient (correct for any batch size).
pub fn atlas_bias_add(x: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    let (m, n, x_on_gpu) = match x {
        VexVal::Tensor(t) => {
            let tb = t.borrow();
            if tb.shape.len() != 2 {
                return Err(atlas_err("ShapeError", format!("Bias add expects a 2D tensor, got {}.", atlas_shape_str(&tb.shape))));
            }
            (tb.shape[0], tb.shape[1], tb.is_gpu())
        }
        _ => return Err(atlas_err("TypeError", format!("Bias add needs a tensor, got {}.", x.type_name()))),
    };
    let bvals = match b {
        VexVal::Tensor(t) => {
            let tb = t.borrow();
            match tb.shape.len() {
                1 if tb.shape[0] == n => {}
                2 if tb.shape[0] == 1 && tb.shape[1] == n => {}
                _ => return Err(atlas_err("ShapeError", format!(
                    "Bias shape {} cannot add to [{}].", atlas_shape_str(&tb.shape), n
                ))),
            }
            tb.to_cpu_vec()?
        }
        _ => return Err(atlas_err("TypeError", format!("Bias add needs a tensor, got {}.", b.type_name()))),
    };
    if bvals.len() != n {
        return Err(atlas_err("ShapeError", "Bias does not match the output size.".to_string()));
    }
    let mut out = match x {
        VexVal::Tensor(t) => t.borrow().to_cpu_vec()?,
        _ => unreachable!(),
    };
    if out.len() != m * n {
        return Err(atlas_err("ShapeError", "Bias add: input tensor size does not match its shape.".to_string()));
    }
    for r in 0..m {
        let base = r * n;
        for c in 0..n {
            out[base + c] += bvals[c];
        }
    }
    let res = if x_on_gpu {
        let buf = vgpu_upload(&out)?;
        VexVal::Tensor(VexTensor::gpu_new(buf, vec![m, n]))
    } else {
        VexVal::Tensor(VexTensor::contiguous_new(out, vec![m, n]))
    };
    atlas_track(&res, AtlasBackwardOp::AddBias, vec![atlas_grad_slot(x), atlas_grad_slot(b)]);
    Ok(res)
}

fn model_apply_activation(h: VexVal, activation: &str) -> Result<VexVal, String> {
    match activation {
        "none" => Ok(h),
        "relu" => vex_tensor_relu(&h),
        "sigmoid" => vex_tensor_sigmoid(&h),
        "tanh" => vex_tensor_tanh(&h),
        other => Err(atlas_err("ValueError", format!(
            "Activation '{}' is not supported (supported: none, relu, sigmoid, tanh).", other
        ))),
    }
}

fn model_forward_inner(cfg: &AtlasModelCfg, params: &Rc<RefCell<Vec<VexVal>>>, input: VexVal, squeeze_out: Option<usize>) -> Result<VexVal, String> {
    // Parameters are the flat canonical list: layer i uses slots 2i (w)
    // and 2i + 1 (b).
    let mut h = input;
    for (li, layer) in cfg.layers.iter().enumerate() {
        let wname = if cfg.arch == "linear" { String::from("w") } else { format!("layers.{}.w", li) };
        let (w, b) = {
            let pb = params.borrow();
            match (pb.get(li * 2), pb.get(li * 2 + 1)) {
                (Some(w), Some(b)) => (w.clone(), b.clone()),
                _ => return Err(atlas_err("ValueError", format!(
                    "Model parameters are missing '{}' — the parameters list was modified.", wname
                ))),
            }
        };
        h = vex_tensor_matmul(&h, &w)?;
        h = atlas_bias_add(&h, &b)?;
        h = model_apply_activation(h, &layer.activation)?;
    }
    if let Some(out_dim) = squeeze_out {
        h = vex_tensor_reshape(&h, &VexVal::Int(out_dim as i64))?;
    }
    Ok(h)
}

// m.forward <tensor> — runs the layer stack. In eval mode the whole
// pass runs inside the inference guard (no graph, no gradients); in
// train mode it tracks normally so backward reaches every parameter.
pub fn vex_model_forward(model: &VexVal, input: &VexVal) -> Result<VexVal, String> {
    let rc = model_rc(model, "forward")?;
    let cfg = atlas_cfg_of(&rc, "of this Model")?;
    let params = model_params(&rc)?;
    let mode = model_mode(&rc);
    let in_tensor = match input {
        VexVal::Tensor(t) => t.clone(),
        _ => return Err(atlas_err("TypeError", format!(
            "forward needs a tensor input, got {}. Build one with tensor [...].", input.type_name()
        ))),
    };
    let (batch, in_dim, squeeze_out) = {
        let b = in_tensor.borrow();
        match b.shape.len() {
            1 => (1usize, b.shape[0], Some(b.shape[0])),
            2 => (b.shape[0], b.shape[1], None),
            _ => return Err(atlas_err("ShapeError", format!(
                "forward expects input shape [size] or [batch, size], got {}.", atlas_shape_str(&b.shape)
            ))),
        }
    };
    let _ = batch;
    let expected = cfg.layers[0].in_dim;
    if in_dim != expected {
        return Err(atlas_err("ShapeError", format!(
            "Model '{}' expects input size {}, got {}.", cfg.name, expected, in_dim
        )));
    }
    // Forward runs where the model lives: place a COPY of the input on
    // the model's parameter device (the caller's tensor is untouched),
    // so `move m to gpu` keeps normal code working without hand-moving
    // every input tensor.
    let model_on_gpu = {
        let ps = params.borrow();
        ps.first()
            .map(|v| matches!(v, VexVal::Tensor(t) if t.borrow().is_gpu()))
            .unwrap_or(false)
    };
    let in_tensor = if model_on_gpu != in_tensor.borrow().is_gpu() {
        let (vals, shape) = {
            let b = in_tensor.borrow();
            (b.to_cpu_vec()?, b.shape.clone())
        };
        if model_on_gpu {
            let buf = vgpu_upload(&vals)?;
            VexTensor::gpu_new(buf, shape)
        } else {
            VexTensor::contiguous_new(vals, shape)
        }
    } else {
        in_tensor.clone()
    };
    let mut shaped = VexVal::Tensor(in_tensor);
    if let Some(_) = squeeze_out {
        shaped = vex_tensor_reshape(&shaped, &VexVal::List(Rc::new(RefCell::new(vec![VexVal::Int(1), VexVal::Int(expected as i64)]))))?;
    }
    if mode == "eval" {
        let _guard = vex_inference_guard();
        model_forward_inner(&cfg, &params, shaped, None)
    } else {
        model_forward_inner(&cfg, &params, shaped, None)
    }
    .and_then(|h| {
        if squeeze_out.is_some() {
            let out_dim = cfg.layers[cfg.layers.len() - 1].out_dim;
            vex_tensor_reshape(&h, &VexVal::Int(out_dim as i64))
        } else {
            Ok(h)
        }
    })
}

fn model_info_from_struct(rc: &Rc<RefCell<VexStruct>>, cfg: &AtlasModelCfg) -> VexVal {
    let path = match rc.borrow().fields.get("path") {
        Some(VexVal::Str(s)) => s.clone(),
        _ => String::new(),
    };
    let params_present = match rc.borrow().fields.get("parameters") {
        Some(VexVal::List(l)) => !l.borrow().is_empty(),
        _ => false,
    };
    let version = match rc.borrow().fields.get("config") {
        Some(c) => config_version(&c.clone()),
        None => ATLAS_MODEL_FORMAT_VERSION,
    };
    info_struct(&path, cfg, version, params_present)
}

fn model_set_mode(rc: &Rc<RefCell<VexStruct>>, mode: &str) -> Result<VexVal, String> {
    {
        let mut b = rc.borrow_mut();
        b.fields.insert(String::from("mode"), VexVal::Str(String::from(mode)));
    }
    if mode == "train" {
        let p = model_params(rc)?;
        let items: Vec<VexVal> = p.borrow().iter().cloned().collect();
        for it in items.iter() {
            if let VexVal::Tensor(t) = it {
                t.borrow_mut().requires_grad = true;
            }
        }
    }
    Ok(VexVal::Null)
}

// m.<member> — reads, info, and the eval/train switches. Also the
// runtime target for members resolved on `any` bases: non-Model values
// fall back to ordinary field access, so hijacked names on user structs
// keep their old behavior.
pub fn vex_model_member_get(model: &VexVal, field: &str) -> Result<VexVal, String> {
    let is_model = match model {
        VexVal::Struct(rc) => rc.borrow().type_name == "Model",
        _ => false,
    };
    if !is_model {
        return vex_field_get(model, field);
    }
    let rc = match model {
        VexVal::Struct(rc) => rc.clone(),
        _ => unreachable!(),
    };
    match field {
        "mode" | "path" | "configuration" | "parameters" => {
            let key = match field { "configuration" => "config", other => other };
            match rc.borrow().fields.get(key) {
                Some(v) => Ok(v.clone()),
                None => Err(atlas_err("ValueError", format!("This Model has no '{}' field.", key))),
            }
        }
        "info" => {
            let cfg = atlas_cfg_of(&rc, "of this Model")?;
            Ok(model_info_from_struct(&rc, &cfg))
        }
        "eval" => model_set_mode(&rc, "eval"),
        "train" => model_set_mode(&rc, "train"),
        "forward" => Err(atlas_err("TypeError",
            "forward needs an input tensor, e.g. m.forward x.".to_string())),
        other => Err(atlas_err("TypeError", format!(
            "Model has no '{}'. Available: mode, path, configuration, parameters, info, eval, train, forward.",
            other
        ))),
    }
}
