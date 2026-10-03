// ===== Atlas v0.5: Hugging Face compatibility (honest boundaries) =====
// Atlas v0.5 reads local model folders only. It recognizes Hugging
// Face style configs and reports exactly what it will not do instead
// of pretending: no fake weights, no silent success, no network.

// True when a config.json looks like a Hugging Face model config
// (they carry `architectures` / `model_type` and no Atlas `format`).
pub fn atlas_config_is_hf(v: &VexVal) -> bool {
    match v {
        VexVal::Struct(rc) => {
            let s = rc.borrow();
            s.fields.contains_key("architectures") || s.fields.contains_key("model_type")
        }
        _ => false,
    }
}

// First entry of `architectures`, when present (for error messages).
pub fn atlas_hf_arch_name(v: &VexVal) -> Option<String> {
    match v {
        VexVal::Struct(rc) => {
            let s = rc.borrow();
            match s.fields.get("architectures") {
                Some(VexVal::List(l)) => {
                    let lb = l.borrow();
                    match lb.first() {
                        Some(VexVal::Str(name)) => Some(name.clone()),
                        _ => None,
                    }
                }
                _ => None,
            }
        }
        _ => None,
    }
}

// True when a missing path looks like a hub repo id ("org/name"):
// contains a slash, no backslashes, and does not exist on disk.
pub fn atlas_looks_like_repo_id(path: &str) -> bool {
    if path.contains('\\') {
        return false;
    }
    if !path.contains('/') {
        return false;
    }
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return false;
    }
    !std::path::Path::new(path).exists()
}

pub fn atlas_hf_unsupported(arch: Option<String>, what: &str) -> String {
    let name = arch.unwrap_or_else(|| "unknown architecture".to_string());
    atlas_err("UnsupportedError", format!(
        "{} looks like a Hugging Face model ({}), which Atlas v0.5 does not load: Atlas supports the native 'linear' and 'mlp' architectures only, and never fetches from the network. Convert the weights to an Atlas folder (config.json + model.atlas) — see docs/model_format.md.",
        what, name
    ))
}

pub fn atlas_hub_unsupported(path: &str) -> String {
    atlas_err("UnsupportedError", format!(
        "'{}' looks like a Hugging Face repo id, but Atlas v0.5 does not download models (no network access). Download the files yourself and load the folder: load model \"path/to/folder\".",
        path
    ))
}
