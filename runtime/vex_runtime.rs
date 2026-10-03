use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

// ===== Vexel runtime (small, no dependencies) =====

#[derive(Clone, Debug)]
pub struct VexStruct {
    pub type_name: String,
    pub fields: HashMap<String, VexVal>,
}

#[derive(Clone, Debug)]
pub enum VexVal {
    Int(i64),
    Float(f64),
    Bool(bool),
    Str(String),
    List(Rc<RefCell<Vec<VexVal>>>),
    Struct(Rc<RefCell<VexStruct>>),
    // Vexel 3.5 Atlas: shared tensor state so flags and gradients
    // written through one handle are visible through all of them
    // (mirrors how List shares its backing vector).
    Tensor(Rc<RefCell<VexTensor>>),
    Null,
}

impl VexVal {
    pub fn type_name(&self) -> &'static str {
        match self {
            VexVal::Int(_) => "integer",
            VexVal::Float(_) => "decimal",
            VexVal::Bool(_) => "boolean",
            VexVal::Str(_) => "string",
            VexVal::List(_) => "list",
            VexVal::Struct(_) => "struct",
            VexVal::Tensor(_) => "tensor",
            VexVal::Null => "null",
        }
    }

    pub fn to_display(&self) -> String {
        match self {
            VexVal::Int(i) => i.to_string(),
            VexVal::Float(f) => {
                if !f.is_finite() {
                    return format!("{}", f);
                }
                // Print integral floats without trailing .0 for nicer output
                if f.fract() == 0.0 && f.abs() < 1e15 {
                    return format!("{}", *f as i64);
                }
                // Trim trailing zeros
                let s = format!("{}", f);
                s
            }
            VexVal::Bool(b) => b.to_string(),
            VexVal::Str(s) => s.clone(),
            VexVal::List(rc) => {
                let v = rc.borrow();
                let parts: Vec<String> = v.iter().map(|e| e.to_display()).collect();
                format!("[{}]", parts.join(", "))
            }
            VexVal::Struct(rc) => {
                let s = rc.borrow();
                // Vexel 2.0: error objects display as their message.
                if s.type_name == "error" {
                    if let Some(m) = s.fields.get("message") {
                        return m.to_display();
                    }
                }
                // Atlas v0.5: Models display as a compact summary —
                // printing one never dumps its weight list.
                if s.type_name == "Model" {
                    let mut name = String::from("model");
                    let mut arch = String::from("?");
                    let mut layers: i64 = 0;
                    if let Some(VexVal::Struct(cr)) = s.fields.get("config") {
                        let cb = cr.borrow();
                        if let Some(VexVal::Str(n)) = cb.fields.get("name") { name = n.clone(); }
                        if let Some(VexVal::Str(a)) = cb.fields.get("arch") { arch = a.clone(); }
                        if let Some(VexVal::List(l)) = cb.fields.get("layers") { layers = l.borrow().len() as i64; }
                    }
                    let params = match s.fields.get("parameters") {
                        Some(VexVal::List(l)) => l.borrow().len() as i64,
                        _ => 0,
                    };
                    let mode = match s.fields.get("mode") {
                        Some(VexVal::Str(m)) => m.clone(),
                        _ => String::from("?"),
                    };
                    return format!("Model{{name: {}, arch: {}, layers: {}, parameters: {}, mode: {}}}",
                        name, arch, layers, params, mode);
                }
                let mut parts: Vec<String> = Vec::new();
                let mut keys: Vec<&String> = s.fields.keys().collect();
                keys.sort();
                for k in keys {
                    parts.push(format!("{}: {}", k, s.fields.get(k).unwrap().to_display()));
                }
                if s.type_name.is_empty() {
                    format!("{{ {} }}", parts.join(", "))
                } else {
                    format!("{}{{ {} }}", s.type_name, parts.join(", "))
                }
            }
            VexVal::Tensor(t) => atlas_format_tensor(&t.borrow()),
            VexVal::Null => String::from("null"),
        }
    }

    pub fn as_bool(&self) -> Result<bool, String> {
        match self {
            VexVal::Bool(b) => Ok(*b),
            _ => Err(format!("Expected boolean but got {}.", self.type_name())),
        }
    }

    pub fn as_int(&self) -> Result<i64, String> {
        match self {
            VexVal::Int(i) => Ok(*i),
            _ => Err(format!("Expected integer but got {}.", self.type_name())),
        }
    }
}

thread_local! {
    static VEX_GLOBALS: RefCell<HashMap<String, VexVal>> = RefCell::new(HashMap::new());
    static VEX_OUTPUT: RefCell<VexVal> = RefCell::new(VexVal::Str(String::new()));
    static VEX_RNG_STATE: RefCell<u64> = RefCell::new(0);
}

pub fn vex_get(name: &str) -> VexVal {
    VEX_GLOBALS.with(|g| {
        g.borrow().get(name).cloned().unwrap_or(VexVal::Null)
    })
}

pub fn vex_set(name: &str, val: VexVal) {
    VEX_GLOBALS.with(|g| {
        g.borrow_mut().insert(name.to_string(), val);
    });
}

pub fn vex_get_output() -> VexVal {
    VEX_OUTPUT.with(|o| o.borrow().clone())
}

// Vexel 2.9: command-line arguments after the program itself.
pub fn vex_args() -> VexVal {
    let list: Vec<VexVal> = std::env::args()
        .skip(1)
        .map(VexVal::Str)
        .collect();
    VexVal::List(Rc::new(RefCell::new(list)))
}

pub fn vex_set_output(val: VexVal) {
    VEX_OUTPUT.with(|o| {
        *o.borrow_mut() = val;
    });
}

fn vex_seed_rng() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0x9e3779b97f4a7c15);
    // Mix with process id and a counter for uniqueness
    let pid = std::process::id() as u64;
    let mut x = now.wrapping_add(pid.wrapping_mul(0x9e3779b97f4a7c15)).wrapping_add(0xbf58476d1ce4e5b9);
    if x == 0 { x = 0x853c49e6748fea9b; }
    x
}

fn vex_rand_next() -> u64 {
    VEX_RNG_STATE.with(|s| {
        let mut state = s.borrow_mut();
        if *state == 0 {
            *state = vex_seed_rng();
        }
        // xorshift64*
        let mut x = *state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        *state = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    })
}

pub fn vex_rand(low: &VexVal, high: &VexVal) -> Result<VexVal, String> {
    let l = low.as_int().map_err(|_| format!("Random bounds must be integers."))?;
    let h = high.as_int().map_err(|_| format!("Random bounds must be integers."))?;
    if l > h {
        return Err(format!("Invalid random range {} to {} (low is greater than high).", l, h));
    }
    let range = (h as u64).wrapping_sub(l as u64).wrapping_add(1);
    let r = vex_rand_next();
    let v = (r % range) as i64 + l;
    Ok(VexVal::Int(v))
}

pub fn vex_input(prompt: &str) -> VexVal {
    print!("{}", prompt);
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    match std::io::stdin().read_line(&mut line) {
        Ok(_) => {
            while line.ends_with('\n') || line.ends_with('\r') {
                line.pop();
            }
            VexVal::Str(line)
        }
        Err(_) => VexVal::Str(String::new()),
    }
}

pub fn vex_print(val: &VexVal) {
    println!("{}", val.to_display());
}

pub fn vex_print_file(path: &str) -> Result<(), String> {
    // Try exact path first. If it has no extension and is missing,
    // also try with `.vxl` appended so `print entities/player`
    // reads the module source as text (without executing it).
    let mut candidates: Vec<String> = vec![path.to_string()];
    if !path.contains('.') {
        candidates.push(format!("{}.vxl", path));
    }
    let mut last_err = format!("File not found: {}", path);
    for cand in candidates.iter() {
        match std::fs::read_to_string(cand) {
            Ok(contents) => {
                // Print contents; ensure trailing newline behavior matches println
                print!("{}", contents);
                if !contents.ends_with('\n') {
                    println!();
                }
                // Flush for prompt-like files
                let _ = std::io::stdout().flush();
                return Ok(());
            }
            Err(_) => {
                last_err = format!("File not found: {}", path);
                continue;
            }
        }
    }
    Err(last_err)
}

pub fn vex_add(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    // String concatenation with coercion if either side is a string
    if matches!(a, VexVal::Str(_)) || matches!(b, VexVal::Str(_)) {
        // Only allow int/decimal/bool/string coercion
        for v in [a, b] {
            match v {
                VexVal::Str(_) | VexVal::Int(_) | VexVal::Float(_) | VexVal::Bool(_) => {},
                _ => return Err(format!("Cannot add {} and {}.", a.type_name(), b.type_name())),
            }
        }
        return Ok(VexVal::Str(format!("{}{}", a.to_display(), b.to_display())));
    }
    match (a, b) {
        (VexVal::Int(x), VexVal::Int(y)) => x.checked_add(*y).map(VexVal::Int).ok_or_else(|| String::from("Integer overflow.")),
        (VexVal::Float(x), VexVal::Float(y)) => Ok(VexVal::Float(x + y)),
        (VexVal::Int(x), VexVal::Float(y)) => Ok(VexVal::Float(*x as f64 + y)),
        (VexVal::Float(x), VexVal::Int(y)) => Ok(VexVal::Float(x + *y as f64)),
        // Vexel 3.4 Atlas: element-wise tensor math (locations ride along).
        (VexVal::Tensor(_), _) | (_, VexVal::Tensor(_)) => vex_tensor_arith('+', a, b),
        _ => Err(format!("Cannot add {} and {}.", a.type_name(), b.type_name())),
    }
}

pub fn vex_sub(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    match (a, b) {
        (VexVal::Int(x), VexVal::Int(y)) => x.checked_sub(*y).map(VexVal::Int).ok_or_else(|| String::from("Integer overflow.")),
        (VexVal::Float(x), VexVal::Float(y)) => Ok(VexVal::Float(x - y)),
        (VexVal::Int(x), VexVal::Float(y)) => Ok(VexVal::Float(*x as f64 - y)),
        (VexVal::Float(x), VexVal::Int(y)) => Ok(VexVal::Float(x - *y as f64)),
        // Vexel 3.4 Atlas: element-wise tensor math.
        (VexVal::Tensor(_), _) | (_, VexVal::Tensor(_)) => vex_tensor_arith('-', a, b),
        _ => Err(format!("Operator '-' requires numbers, got {} and {}.", a.type_name(), b.type_name())),
    }
}

pub fn vex_mul(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    match (a, b) {
        (VexVal::Int(x), VexVal::Int(y)) => x.checked_mul(*y).map(VexVal::Int).ok_or_else(|| String::from("Integer overflow.")),
        (VexVal::Float(x), VexVal::Float(y)) => Ok(VexVal::Float(x * y)),
        (VexVal::Int(x), VexVal::Float(y)) => Ok(VexVal::Float(*x as f64 * y)),
        (VexVal::Float(x), VexVal::Int(y)) => Ok(VexVal::Float(x * *y as f64)),
        // Vexel 3.4 Atlas: element-wise tensor math (never matmul — use @).
        (VexVal::Tensor(_), _) | (_, VexVal::Tensor(_)) => vex_tensor_arith('*', a, b),
        _ => Err(format!("Operator '*' requires numbers, got {} and {}.", a.type_name(), b.type_name())),
    }
}

pub fn vex_div(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    match (a, b) {
        (VexVal::Int(_), VexVal::Int(0)) => Err(String::from("Division by zero.")),
        (VexVal::Int(x), VexVal::Int(y)) => Ok(VexVal::Float(*x as f64 / *y as f64)),
        (VexVal::Float(_), VexVal::Float(y)) if *y == 0.0 => Err(String::from("Division by zero.")),
        (VexVal::Float(x), VexVal::Float(y)) => Ok(VexVal::Float(x / y)),
        (VexVal::Int(x), VexVal::Float(y)) => {
            if *y == 0.0 { return Err(String::from("Division by zero.")); }
            Ok(VexVal::Float(*x as f64 / y))
        }
        (VexVal::Float(x), VexVal::Int(y)) => {
            if *y == 0 { return Err(String::from("Division by zero.")); }
            Ok(VexVal::Float(x / *y as f64))
        }
        // Vexel 3.4 Atlas: element-wise tensor math.
        (VexVal::Tensor(_), _) | (_, VexVal::Tensor(_)) => vex_tensor_arith('/', a, b),
        _ => Err(format!("Operator '/' requires numbers, got {} and {}.", a.type_name(), b.type_name())),
    }
}

pub fn vex_rem(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    match (a, b) {
        (_, VexVal::Int(0)) => Err(String::from("Division by zero.")),
        (VexVal::Int(x), VexVal::Int(y)) => Ok(VexVal::Int(x % y)),
        _ => Err(format!("Operator '%' requires integers, got {} and {}.", a.type_name(), b.type_name())),
    }
}

pub fn vex_neg(a: &VexVal) -> Result<VexVal, String> {
    match a {
        VexVal::Int(x) => x.checked_neg().map(VexVal::Int).ok_or_else(|| String::from("Integer overflow.")),
        VexVal::Float(x) => Ok(VexVal::Float(-x)),
        _ => Err(format!("Unary '-' requires a number, got {}.", a.type_name())),
    }
}

fn vex_num_cmp(a: &VexVal, b: &VexVal) -> Result<std::cmp::Ordering, String> {
    match (a, b) {
        (VexVal::Int(x), VexVal::Int(y)) => Ok(x.cmp(y)),
        (VexVal::Float(x), VexVal::Float(y)) => x.partial_cmp(y).ok_or_else(|| String::from("Invalid decimal comparison.")),
        (VexVal::Int(x), VexVal::Float(y)) => (*x as f64).partial_cmp(y).ok_or_else(|| String::from("Invalid decimal comparison.")),
        (VexVal::Float(x), VexVal::Int(y)) => x.partial_cmp(&(*y as f64)).ok_or_else(|| String::from("Invalid decimal comparison.")),
        _ => Err(format!("Comparison requires numbers, got {} and {}.", a.type_name(), b.type_name())),
    }
}

fn vex_deep_eq(a: &VexVal, b: &VexVal) -> bool {
    match (a, b) {
        (VexVal::Int(x), VexVal::Int(y)) => x == y,
        (VexVal::Float(x), VexVal::Float(y)) => x == y,
        (VexVal::Int(x), VexVal::Float(y)) => *x as f64 == *y,
        (VexVal::Float(x), VexVal::Int(y)) => *x == *y as f64,
        (VexVal::Bool(x), VexVal::Bool(y)) => x == y,
        (VexVal::Str(x), VexVal::Str(y)) => x == y,
        (VexVal::List(a1), VexVal::List(b1)) => {
            let av = a1.borrow();
            let bv = b1.borrow();
            if av.len() != bv.len() { return false; }
            for (x, y) in av.iter().zip(bv.iter()) {
                if !vex_deep_eq(x, y) { return false; }
            }
            true
        }
        (VexVal::Struct(a1), VexVal::Struct(b1)) => {
            let av = a1.borrow();
            let bv = b1.borrow();
            if av.type_name != bv.type_name { return false; }
            if av.fields.len() != bv.fields.len() { return false; }
            for (k, v) in av.fields.iter() {
                match bv.fields.get(k) {
                    Some(w) => if !vex_deep_eq(v, w) { return false; },
                    None => return false,
                }
            }
            true
        }
        (VexVal::Null, VexVal::Null) => true,
        (VexVal::Tensor(a1), VexVal::Tensor(b1)) => {
            let a = a1.borrow();
            let b = b1.borrow();
            if a.shape != b.shape {
                return false;
            }
            // Host reads (GPU tensors download here); equality is by
            // value across devices. An unreadable tensor cannot prove
            // equality, so it is not equal.
            match (a.to_cpu_vec(), b.to_cpu_vec()) {
                (Ok(av), Ok(bv)) => av == bv,
                _ => false,
            }
        }
        _ => false,
    }
}

pub fn vex_eq(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    Ok(VexVal::Bool(vex_deep_eq(a, b)))
}

pub fn vex_neq(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    Ok(VexVal::Bool(!vex_deep_eq(a, b)))
}

pub fn vex_gt(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    Ok(VexVal::Bool(vex_num_cmp(a, b)? == std::cmp::Ordering::Greater))
}

pub fn vex_lt(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    Ok(VexVal::Bool(vex_num_cmp(a, b)? == std::cmp::Ordering::Less))
}

pub fn vex_gte(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    let o = vex_num_cmp(a, b)?;
    Ok(VexVal::Bool(o == std::cmp::Ordering::Greater || o == std::cmp::Ordering::Equal))
}

pub fn vex_lte(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    let o = vex_num_cmp(a, b)?;
    Ok(VexVal::Bool(o == std::cmp::Ordering::Less || o == std::cmp::Ordering::Equal))
}

pub fn vex_and(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    Ok(VexVal::Bool(a.as_bool()? && b.as_bool()?))
}

pub fn vex_or(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    Ok(VexVal::Bool(a.as_bool()? || b.as_bool()?))
}

pub fn vex_not(a: &VexVal) -> Result<VexVal, String> {
    Ok(VexVal::Bool(!a.as_bool()?))
}

pub fn vex_len(v: &VexVal) -> Result<VexVal, String> {
    match v {
        VexVal::Str(s) => Ok(VexVal::Int(s.chars().count() as i64)),
        VexVal::List(rc) => Ok(VexVal::Int(rc.borrow().len() as i64)),
        _ => Err(format!("Length requires a string or list, got {}.", v.type_name())),
    }
}

pub fn vex_number_of(v: &VexVal) -> Result<VexVal, String> {
    match v {
        VexVal::Int(_) | VexVal::Float(_) => Ok(v.clone()),
        VexVal::Str(s) => {
            let t = s.trim();
            if let Ok(i) = t.parse::<i64>() {
                return Ok(VexVal::Int(i));
            }
            match t.parse::<f64>() {
                Ok(f) if f.is_finite() => Ok(VexVal::Float(f)),
                _ => Err(format!("Cannot convert \"{}\" to a number.", s)),
            }
        }
        _ => Err(format!("Cannot convert {} to a number.", v.type_name())),
    }
}

pub fn vex_index_get(base: &VexVal, idx: &VexVal) -> Result<VexVal, String> {
    let i = idx.as_int().map_err(|_| format!("Index must be an integer."))?;
    if i < 0 {
        return Err(format!("Index out of bounds: {}.", i));
    }
    match base {
        VexVal::List(rc) => {
            let v = rc.borrow();
            if (i as usize) >= v.len() {
                return Err(format!("Index out of bounds: {} (length {}).", i, v.len()));
            }
            Ok(v[i as usize].clone())
        }
        VexVal::Str(s) => {
            let chars: Vec<char> = s.chars().collect();
            if (i as usize) >= chars.len() {
                return Err(format!("Index out of bounds: {} (length {}).", i, chars.len()));
            }
            Ok(VexVal::Str(chars[i as usize].to_string()))
        }
        // Vexel 3.4/3.5 Atlas: tensor element (rank 1) or sub-tensor.
        // Delegates so GPU dispatch (host copy + move back) applies here too.
        VexVal::Tensor(_) => vex_tensor_index(base, idx),
        _ => Err(format!("Cannot index {}.", base.type_name())),
    }
}

pub fn vex_index_set(base: &VexVal, idx: &VexVal, val: VexVal) -> Result<(), String> {
    let i = idx.as_int().map_err(|_| format!("Index must be an integer."))?;
    if i < 0 {
        return Err(format!("Index out of bounds: {}.", i));
    }
    match base {
        VexVal::List(rc) => {
            let mut v = rc.borrow_mut();
            if (i as usize) >= v.len() {
                return Err(format!("Index out of bounds: {} (length {}).", i, v.len()));
            }
            v[i as usize] = val;
            Ok(())
        }
        _ => Err(format!("Cannot assign to index of {}.", base.type_name())),
    }
}

pub fn vex_field_get(base: &VexVal, field: &str) -> Result<VexVal, String> {
    match base {
        VexVal::Struct(rc) => {
            let s = rc.borrow();
            s.fields.get(field).cloned().ok_or_else(|| format!("Struct {} has no field '{}'.", s.type_name, field))
        }
        // Vexel 3.4/3.5 Atlas: tensor members also resolve on any-typed bases.
        VexVal::Tensor(t) => vex_tensor_get_inner(t, field),
        _ => Err(format!("{} has no field '{}'.", base.type_name(), field)),
    }
}

pub fn vex_field_set(base: &VexVal, field: &str, val: VexVal) -> Result<(), String> {
    match base {
        VexVal::Struct(rc) => {
            let mut s = rc.borrow_mut();
            if !s.fields.contains_key(field) {
                return Err(format!("Struct {} has no field '{}'.", s.type_name, field));
            }
            s.fields.insert(field.to_string(), val);
            Ok(())
        }
        _ => Err(format!("{} has no field '{}'.", base.type_name(), field)),
    }
}

pub fn vex_struct_new(type_name: &str, fields: Vec<(String, VexVal)>) -> VexVal {
    let mut map = HashMap::new();
    for (k, v) in fields {
        map.insert(k, v);
    }
    VexVal::Struct(Rc::new(RefCell::new(VexStruct {
        type_name: type_name.to_string(),
        fields: map,
    })))
}

pub fn vex_char_at(base: &VexVal, idx: &VexVal) -> Result<VexVal, String> {
    // Vexel 1.1.0: [i] from works on lists too (element access).
    if matches!(base, VexVal::List(_)) {
        return vex_index_get(base, idx);
    }
    match base {
        VexVal::Str(s) => {
            let i = idx.as_int().map_err(|_| format!("Character index must be an integer."))?;
            if i < 0 {
                return Err(format!("Index out of bounds: {}.", i));
            }
            let chars: Vec<char> = s.chars().collect();
            if (i as usize) >= chars.len() {
                return Err(format!("Index out of bounds: {} (length {}).", i, chars.len()));
            }
            Ok(VexVal::Str(chars[i as usize].to_string()))
        }
        _ => Err(format!("Can only get items from a string or list, got {}.", base.type_name())),
    }
}

pub fn vex_make_upper(v: &VexVal) -> Result<VexVal, String> {
    match v {
        VexVal::Str(s) => Ok(VexVal::Str(s.to_uppercase())),
        _ => Err(format!("Make upper requires a string, got {}.", v.type_name())),
    }
}

pub fn vex_make_lower(v: &VexVal) -> Result<VexVal, String> {
    match v {
        VexVal::Str(s) => Ok(VexVal::Str(s.to_lowercase())),
        _ => Err(format!("Make lower requires a string, got {}.", v.type_name())),
    }
}

pub fn vex_list_add(base: &VexVal, val: &VexVal) -> Result<(), String> {
    match base {
        VexVal::List(rc) => {
            rc.borrow_mut().push(val.clone());
            Ok(())
        }
        _ => Err(format!("Cannot add to {}.", base.type_name())),
    }
}

pub fn vex_list_remove(base: &VexVal, idx: &VexVal) -> Result<(), String> {
    let i = idx.as_int().map_err(|_| format!("List remove requires an integer index."))?;
    if i < 0 {
        return Err(format!("Index out of bounds: {}.", i));
    }
    match base {
        VexVal::List(rc) => {
            let mut v = rc.borrow_mut();
            if (i as usize) >= v.len() {
                return Err(format!("Index out of bounds: {} (length {}).", i, v.len()));
            }
            v.remove(i as usize);
            Ok(())
        }
        _ => Err(format!("Cannot remove from {}.", base.type_name())),
    }
}

pub fn vex_make_number(v: &VexVal) -> Result<VexVal, String> {
    // Vexel 2.0: make x number — text becomes a number (integers stay ints).
    match v {
        VexVal::Int(_) | VexVal::Float(_) => Ok(v.clone()),
        VexVal::Str(s) => {
            let t = s.trim();
            if let Ok(i) = t.parse::<i64>() {
                return Ok(VexVal::Int(i));
            }
            match t.parse::<f64>() {
                Ok(f) if f.is_finite() => Ok(VexVal::Float(f)),
                _ => Err(format!("Cannot convert \"{}\" to a number.", s)),
            }
        }
        _ => Err(format!("Cannot convert {} to a number.", v.type_name())),
    }
}

pub fn vex_make_string(v: &VexVal) -> Result<VexVal, String> {
    // Vexel 2.0: make x string — anything printable becomes text.
    match v {
        VexVal::Str(_) => Ok(v.clone()),
        VexVal::Int(_) | VexVal::Float(_) | VexVal::Bool(_) | VexVal::Null => Ok(VexVal::Str(v.to_display())),
        _ => Err(format!("Cannot convert {} to a string.", v.type_name())),
    }
}

pub fn vex_make_boolean(v: &VexVal) -> Result<VexVal, String> {
    // Vexel 2.0: make x boolean — booleans pass, text parses true/false.
    match v {
        VexVal::Bool(_) => Ok(v.clone()),
        VexVal::Str(s) => {
            let t = s.trim().to_lowercase();
            if t == "true" {
                return Ok(VexVal::Bool(true));
            }
            if t == "false" {
                return Ok(VexVal::Bool(false));
            }
            Err(format!("Cannot convert \"{}\" to a boolean (expected true or false).", s))
        }
        _ => Err(format!("Cannot convert {} to a boolean.", v.type_name())),
    }
}

// ---------- Vexel 2.0 minimal JSON (no dependencies) ----------

fn vex_json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
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

pub fn vex_json_stringify(v: &VexVal) -> Result<String, String> {
    match v {
        VexVal::Null => Ok(String::from("null")),
        VexVal::Bool(b) => Ok(b.to_string()),
        VexVal::Int(i) => Ok(i.to_string()),
        VexVal::Float(f) => {
            if !f.is_finite() {
                return Err(String::from("Cannot write non-finite number to JSON."));
            }
            Ok(format!("{}", f))
        }
        VexVal::Str(s) => Ok(format!("\"{}\"", vex_json_escape(s))),
        VexVal::List(rc) => {
            let borrowed = rc.borrow();
            let mut parts: Vec<String> = Vec::new();
            for e in borrowed.iter() {
                parts.push(vex_json_stringify(e)?);
            }
            Ok(format!("[{}]", parts.join(", ")))
        }
        VexVal::Struct(rc) => {
            let s = rc.borrow();
            let mut keys: Vec<&String> = s.fields.keys().collect();
            keys.sort();
            let mut parts: Vec<String> = Vec::new();
            for k in keys {
                parts.push(format!("\"{}\": {}", vex_json_escape(k), vex_json_stringify(s.fields.get(k).unwrap())?));
            }
            Ok(format!("{{{}}}", parts.join(", ")))
        }
        // Vexel 3.4 Atlas: tensors serialize as nested JSON arrays.
        VexVal::Tensor(t) => Ok(atlas_format_json(&t.borrow())?),
    }
}

struct VexJsonParser<'a> {
    chars: Vec<char>,
    pos: usize,
    path: &'a str,
}

impl<'a> VexJsonParser<'a> {
    fn new(text: &'a str, path: &'a str) -> VexJsonParser<'a> {
        VexJsonParser { chars: text.chars().collect(), pos: 0, path }
    }

    fn fail(&self, what: &str) -> String {
        format!("Invalid JSON in {}: {} (near position {}).", self.path, what, self.pos)
    }

    fn skip_ws(&mut self) {
        while self.pos < self.chars.len() && (self.chars[self.pos] == ' ' || self.chars[self.pos] == '\t' || self.chars[self.pos] == '\n' || self.chars[self.pos] == '\r') {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).cloned()
    }

    fn eat(&mut self, c: char) -> Result<(), String> {
        if self.peek() == Some(c) {
            self.pos += 1;
            Ok(())
        } else {
            Err(self.fail(&format!("expected '{}'", c)))
        }
    }

    fn parse_value(&mut self) -> Result<VexVal, String> {
        self.skip_ws();
        match self.peek() {
            None => Err(self.fail("unexpected end")),
            Some('{') => self.parse_object(),
            Some('[') => self.parse_array(),
            Some('"') => Ok(VexVal::Str(self.parse_string()?)),
            Some('t') => {
                self.expect_word("true")?;
                Ok(VexVal::Bool(true))
            }
            Some('f') => {
                self.expect_word("false")?;
                Ok(VexVal::Bool(false))
            }
            Some('n') => {
                self.expect_word("null")?;
                Ok(VexVal::Null)
            }
            Some(c) if c == '-' || (c >= '0' && c <= '9') => self.parse_number(),
            Some(c) => Err(self.fail(&format!("unexpected character '{}'", c))),
        }
    }

    fn expect_word(&mut self, word: &str) -> Result<(), String> {
        for wc in word.chars() {
            if self.peek() != Some(wc) {
                return Err(self.fail(&format!("expected '{}'", word)));
            }
            self.pos += 1;
        }
        Ok(())
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.eat('"')?;
        let mut out = String::new();
        loop {
            match self.peek() {
                None => return Err(self.fail("unterminated string")),
                Some('"') => {
                    self.pos += 1;
                    return Ok(out);
                }
                Some('\\') => {
                    self.pos += 1;
                    match self.peek() {
                        None => return Err(self.fail("unterminated escape")),
                        Some('n') => out.push('\n'),
                        Some('r') => out.push('\r'),
                        Some('t') => out.push('\t'),
                        Some('"') => out.push('"'),
                        Some('\\') => out.push('\\'),
                        Some('/') => out.push('/'),
                        Some('b') => out.push('\u{0008}'),
                        Some('f') => out.push('\u{000C}'),
                        Some('u') => {
                            self.pos += 1;
                            let mut code: u32 = 0;
                            for _ in 0..4 {
                                match self.peek() {
                                    Some(h) if h.is_digit(16) => {
                                        code = code * 16 + h.to_digit(16).unwrap();
                                        self.pos += 1;
                                    }
                                    _ => return Err(self.fail("bad unicode escape")),
                                }
                            }
                            match std::char::from_u32(code) {
                                Some(ch) => out.push(ch),
                                None => return Err(self.fail("bad unicode escape")),
                            }
                            continue;
                        }
                        Some(c) => return Err(self.fail(&format!("bad escape '\\{}'", c))),
                    }
                    self.pos += 1;
                }
                Some(c) => {
                    out.push(c);
                    self.pos += 1;
                }
            }
        }
    }

    fn parse_number(&mut self) -> Result<VexVal, String> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        let mut is_float = false;
        while self.pos < self.chars.len() {
            let c = self.chars[self.pos];
            if c >= '0' && c <= '9' {
                self.pos += 1;
            } else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') && self.pos > start {
                is_float = true;
                self.pos += 1;
            } else {
                break;
            }
        }
        let raw: String = self.chars[start..self.pos].iter().collect();
        if raw.is_empty() || raw == "-" {
            return Err(self.fail("bad number"));
        }
        if !is_float {
            if let Ok(i) = raw.parse::<i64>() {
                return Ok(VexVal::Int(i));
            }
        }
        match raw.parse::<f64>() {
            Ok(f) if f.is_finite() => Ok(VexVal::Float(f)),
            _ => Err(self.fail(&format!("bad number '{}'", raw))),
        }
    }

    fn parse_array(&mut self) -> Result<VexVal, String> {
        self.eat('[')?;
        let mut items: Vec<VexVal> = Vec::new();
        loop {
            self.skip_ws();
            if self.peek() == Some(']') {
                self.pos += 1;
                break;
            }
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(',') => {
                    self.pos += 1;
                }
                Some(']') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(self.fail("expected ',' or ']'")),
            }
        }
        Ok(VexVal::List(Rc::new(RefCell::new(items))))
    }

    fn parse_object(&mut self) -> Result<VexVal, String> {
        self.eat('{')?;
        let mut map: HashMap<String, VexVal> = HashMap::new();
        loop {
            self.skip_ws();
            if self.peek() == Some('}') {
                self.pos += 1;
                break;
            }
            if self.peek() != Some('"') {
                return Err(self.fail("expected a \"key\""));
            }
            let key = self.parse_string()?;
            self.skip_ws();
            self.eat(':')?;
            let val = self.parse_value()?;
            map.insert(key, val);
            self.skip_ws();
            match self.peek() {
                Some(',') => {
                    self.pos += 1;
                }
                Some('}') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(self.fail("expected ',' or '}'")),
            }
        }
        Ok(VexVal::Struct(Rc::new(RefCell::new(VexStruct { type_name: String::new(), fields: map }))))
    }
}

pub fn vex_json_parse(text: &str, path: &str) -> Result<VexVal, String> {
    let mut p = VexJsonParser::new(text, path);
    let v = p.parse_value()?;
    p.skip_ws();
    if p.pos != p.chars.len() {
        return Err(p.fail("trailing characters"));
    }
    Ok(v)
}

pub fn vex_json_read(path: &str) -> Result<VexVal, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => vex_json_parse(&contents, path),
        Err(_) => Err(format!("File not found: {}", path)),
    }
}

pub fn vex_json_write(val: &VexVal, path: &str) -> Result<(), String> {
    let text = vex_json_stringify(val)?;
    match std::fs::write(path, text) {
        Ok(()) => Ok(()),
        Err(e) => Err(format!("Cannot write {}: {}", path, e)),
    }
}

// Allow unused import warning suppression for generated code
#[allow(dead_code)]
fn __vex_allow_dead() {
    let _ = Ordering::SeqCst;
    let _ = AtomicBool::new(false);
}

// ===== Vexel 2.9: background tasks (console worker threads) =====
// Workers get a read-only snapshot of globals (JSON data); the `result`
// box is the only channel back. States mirror the UI task model.

struct VexTaskRec {
    state: std::sync::Mutex<String>,
    result: std::sync::Mutex<String>,
    error: std::sync::Mutex<String>,
    cancel: AtomicBool,
}

fn vex_task_table() -> &'static std::sync::Mutex<std::collections::HashMap<u64, std::sync::Arc<VexTaskRec>>> {
    static TABLE: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<u64, std::sync::Arc<VexTaskRec>>>,
    > = std::sync::OnceLock::new();
    TABLE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

static VEX_TASK_NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

thread_local! {
    static VEX_TASK_CURRENT: RefCell<u64> = RefCell::new(0);
}

pub fn vex_snapshot_globals() -> String {
    let map: std::collections::HashMap<String, VexVal> =
        VEX_GLOBALS.with(|g| g.borrow().clone());
    match vex_json_stringify(&VexVal::Struct(Rc::new(RefCell::new(VexStruct {
        type_name: String::new(),
        fields: map,
    })))) {
        Ok(s) => s,
        Err(_) => String::from("{}"),
    }
}

pub fn vex_task_spawn(
    snapshot: String,
    body: Box<dyn FnOnce() -> Result<String, String> + Send>,
) -> u64 {
    use std::sync::atomic::Ordering as AOrd;
    let id = VEX_TASK_NEXT.fetch_add(1, AOrd::SeqCst);
    let rec = std::sync::Arc::new(VexTaskRec {
        state: std::sync::Mutex::new("pending".to_string()),
        result: std::sync::Mutex::new(String::new()),
        error: std::sync::Mutex::new(String::new()),
        cancel: AtomicBool::new(false),
    });
    vex_task_table().lock().unwrap().insert(id, rec.clone());
    std::thread::spawn(move || {
        *rec.state.lock().unwrap() = "running".to_string();
        VEX_TASK_CURRENT.with(|c| {
            *c.borrow_mut() = id;
        });
        // Seed worker globals from the snapshot (read-only by convention).
        if let Ok(VexVal::Struct(s)) = vex_json_parse(&snapshot, "<task>") {
            for (k, v) in s.borrow().fields.iter() {
                vex_set(k, v.clone());
            }
        }
        match body() {
            Ok(json) => {
                *rec.result.lock().unwrap() = json;
                *rec.state.lock().unwrap() = "completed".to_string();
            }
            Err(e) => {
                if e == "Task cancelled." {
                    *rec.state.lock().unwrap() = "cancelled".to_string();
                } else {
                    *rec.error.lock().unwrap() = e;
                    *rec.state.lock().unwrap() = "failed".to_string();
                }
            }
        }
    });
    id
}

fn vex_task_get(id: u64) -> Result<std::sync::Arc<VexTaskRec>, String> {
    vex_task_table()
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("Unknown task handle: {}", id))
}

fn vex_task_id(v: &VexVal) -> Result<u64, String> {
    match v {
        VexVal::Int(i) if *i > 0 => Ok(*i as u64),
        _ => Err("wait needs a task handle (e.g. wait fetch).".to_string()),
    }
}

pub fn vex_task_state(h: &VexVal) -> Result<VexVal, String> {
    let rec = vex_task_get(vex_task_id(h)?)?;
    let s = rec.state.lock().unwrap().clone();
    Ok(VexVal::Str(s))
}

pub fn vex_task_result(h: &VexVal) -> Result<VexVal, String> {
    let rec = vex_task_get(vex_task_id(h)?)?;
    if *rec.state.lock().unwrap() != "completed" {
        return Err("Task has not completed yet. Poll handle.state first.".to_string());
    }
    let json = rec.result.lock().unwrap().clone();
    if json.is_empty() {
        return Ok(VexVal::Null);
    }
    vex_json_parse(&json, "<task result>")
        .map_err(|e| format!("Task returned an unreadable result: {}", e))
}

pub fn vex_task_error(h: &VexVal) -> Result<VexVal, String> {
    let rec = vex_task_get(vex_task_id(h)?)?;
    let mut fields = std::collections::HashMap::new();
    fields.insert(
        "message".to_string(),
        VexVal::Str(rec.error.lock().unwrap().clone()),
    );
    fields.insert("type".to_string(), VexVal::Str("RuntimeError".to_string()));
    Ok(VexVal::Struct(Rc::new(RefCell::new(VexStruct {
        type_name: "error".to_string(),
        fields,
    }))))
}

pub fn vex_task_cancel(h: &VexVal) -> Result<VexVal, String> {
    let rec = vex_task_get(vex_task_id(h)?)?;
    rec.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(VexVal::Null)
}

pub fn vex_task_wait(h: &VexVal) -> Result<VexVal, String> {
    let rec = vex_task_get(vex_task_id(h)?)?;
    loop {
        let s = rec.state.lock().unwrap().clone();
        if s == "completed" || s == "failed" || s == "cancelled" {
            return Ok(VexVal::Null);
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

// Cooperative cancellation checkpoint for loop heads and sleeps.
pub fn vex_task_check_cancel() -> Result<VexVal, String> {
    let id = VEX_TASK_CURRENT.with(|c| *c.borrow());
    if id == 0 {
        return Ok(VexVal::Null);
    }
    if let Ok(rec) = vex_task_get(id) {
        if rec.cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Task cancelled.".to_string());
        }
    }
    Ok(VexVal::Null)
}

pub fn vex_task_sleep(secs: f64) -> Result<VexVal, String> {
    if secs < 0.0 {
        return Err("Wait needs a non-negative number of seconds.".to_string());
    }
    let end = std::time::Instant::now() + std::time::Duration::from_secs_f64(secs);
    loop {
        vex_task_check_cancel()?;
        if std::time::Instant::now() >= end {
            return Ok(VexVal::Null);
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

// ===== Vexel 2.9: HTTP over plain TCP (console backend, http:// only) =====

thread_local! {
    static VEX_HTTP_TIMEOUT: RefCell<f64> = RefCell::new(30.0);
}

pub fn vex_http_set_timeout(secs: &VexVal) -> Result<VexVal, String> {
    let s = match secs {
        VexVal::Int(i) => *i as f64,
        VexVal::Float(f) => *f,
        _ => return Err("http timeout needs seconds.".to_string()),
    };
    if !(s > 0.0) {
        return Err("http timeout needs a positive number of seconds.".to_string());
    }
    VEX_HTTP_TIMEOUT.with(|t| {
        *t.borrow_mut() = s;
    });
    Ok(VexVal::Null)
}

fn vex_http_timeout() -> std::time::Duration {
    let s = VEX_HTTP_TIMEOUT.with(|t| *t.borrow());
    std::time::Duration::from_secs_f64(if s.is_finite() && s > 0.0 { s } else { 30.0 })
}

fn vex_http_split_url(url: &str) -> Result<(String, String), String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| "Console programs reach http:// URLs only. Build a desktop app for https://.".to_string())?;
    let (host_port, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    if host_port.is_empty() {
        return Err(format!("HTTP Error: Invalid URL '{}'.", url));
    }
    Ok((host_port.to_string(), path.to_string()))
}

fn vex_http_decode_chunked(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    loop {
        let mut j = i;
        while j + 1 < raw.len() && !(raw[j] == b'\r' && raw[j + 1] == b'\n') {
            j += 1;
        }
        if j + 1 >= raw.len() {
            break;
        }
        let size_str = String::from_utf8_lossy(&raw[i..j]).to_string();
        let size = usize::from_str_radix(size_str.trim().split(';').next().unwrap_or(""), 16).unwrap_or(0);
        i = j + 2;
        if size == 0 {
            break;
        }
        if i + size > raw.len() {
            out.extend_from_slice(&raw[i..]);
            break;
        }
        out.extend_from_slice(&raw[i..i + size]);
        i += size + 2;
    }
    out
}

pub fn vex_http_request(
    method: &str,
    url: &VexVal,
    body: &VexVal,
    headers: &VexVal,
) -> Result<VexVal, String> {
    let url_s = url.to_display();
    let (host_port, path) = vex_http_split_url(&url_s)?;
    let timeout = vex_http_timeout();
    // Resolve host (literals connect directly; names go through DNS).
    use std::net::ToSocketAddrs as _VexToAddrs;
    let (host, port) = match host_port.rfind(':') {
        Some(i) if host_port[i + 1..].chars().all(|c| c.is_ascii_digit()) => {
            (&host_port[..i], host_port[i + 1..].parse().unwrap_or(80))
        }
        _ => (host_port.as_str(), 80),
    };
    if host.is_empty() {
        return Err(format!("HTTP Error: Invalid URL '{}'.", url_s));
    }
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|_| format!("HTTP Error: Could not reach '{}'.", url_s))?
        .next()
        .ok_or_else(|| format!("HTTP Error: Could not reach '{}'.", url_s))?;
    // Body: text raw, objects/lists as JSON, null as empty.
    let (body_text, is_json) = match body {
        VexVal::Null => (String::new(), false),
        VexVal::Str(s) => (s.clone(), false),
        VexVal::Struct(_) | VexVal::List(_) => (vex_json_stringify(body)?, true),
        other => {
            return Err(format!(
                "HTTP body must be text or an object, got {}.",
                other.type_name()
            ))
        }
    };
    // Headers from a struct/object value.
    if !matches!(headers, VexVal::Null) && !matches!(headers, VexVal::Struct(_)) {
        return Err(format!(
            "HTTP headers must be an object, got {}.",
            headers.type_name()
        ));
    }
    let mut header_list: Vec<(String, String)> = Vec::new();
    let mut push_headers = |v: &VexVal| {
        if let VexVal::Struct(s) = v {
            let mut keys: Vec<String> = s.borrow().fields.keys().cloned().collect();
            keys.sort();
            for k in keys {
                let v = s.borrow().fields.get(&k).unwrap().to_display();
                header_list.push((k, v));
            }
        }
    };
    push_headers(headers);
    let mut req = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nUser-Agent: vexel/2.9\r\n",
        method.to_uppercase(),
        path,
        host_port
    );
    if is_json {
        req.push_str("Content-Type: application/json\r\n");
    } else if !body_text.is_empty() {
        req.push_str("Content-Type: text/plain\r\n");
    }
    for (k, v) in &header_list {
        req.push_str(&format!("{}: {}\r\n", k, v));
    }
    if !body_text.is_empty() {
        req.push_str(&format!("Content-Length: {}\r\n", body_text.len()));
    }
    req.push_str("\r\n");
    req.push_str(&body_text);
    let mut stream = std::net::TcpStream::connect_timeout(&addr, timeout)
        .map_err(|_| format!("HTTP Error: Could not reach '{}'.", url_s))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| format!("HTTP Error: Could not reach '{}'.", url_s))?;
    std::io::Write::write_all(&mut stream, req.as_bytes())
        .map_err(|_| format!("HTTP Error: Could not reach '{}'.", url_s))?;
    let mut raw: Vec<u8> = Vec::new();
    {
        use std::io::Read as _VexRead;
        match _VexRead::read_to_end(&mut stream, &mut raw) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                return Err(format!("HTTP Error: Request to '{}' timed out.", url_s))
            }
            Err(_) => return Err(format!("HTTP Error: Could not reach '{}'.", url_s)),
        }
    }
    let text = String::from_utf8_lossy(&raw).to_string();
    let (head, mut body_bytes) = match text.find("\r\n\r\n") {
        Some(i) => (&text[..i], text[i + 4..].as_bytes().to_vec()),
        None => (text.as_str(), Vec::new()),
    };
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let status: i64 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);
    let mut header_map = std::collections::HashMap::new();
    let mut chunked = false;
    for line in lines {
        if let Some(i) = line.find(':') {
            let k = line[..i].trim().to_lowercase();
            let v = line[i + 1..].trim().to_string();
            if k == "transfer-encoding" && v.to_lowercase().contains("chunked") {
                chunked = true;
            }
            header_map.insert(k, VexVal::Str(v));
        }
    }
    if chunked {
        body_bytes = vex_http_decode_chunked(&body_bytes);
    }
    let body_text = String::from_utf8_lossy(&body_bytes).to_string();
    let mut fields = std::collections::HashMap::new();
    fields.insert("status".to_string(), VexVal::Int(status));
    fields.insert("text".to_string(), VexVal::Str(body_text.clone()));
    fields.insert("body".to_string(), VexVal::Str(body_text));
    fields.insert(
        "headers".to_string(),
        VexVal::Struct(Rc::new(RefCell::new(VexStruct {
            type_name: String::new(),
            fields: header_map,
        }))),
    );
    Ok(VexVal::Struct(Rc::new(RefCell::new(VexStruct {
        type_name: String::new(),
        fields,
    }))))
}

// ===== Vexel 2.9: terminal sessions (persistent working directory) =====

thread_local! {
    static VEX_TERM_DIR: RefCell<Option<String>> = RefCell::new(None);
}

fn vex_term_cwd() -> String {
    VEX_TERM_DIR.with(|d| {
        if let Some(s) = d.borrow().clone() {
            return s;
        }
        let cur = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string());
        *d.borrow_mut() = Some(cur.clone());
        cur
    })
}

pub fn vex_term_cd(dir: &VexVal) -> Result<VexVal, String> {
    let rel = dir.to_display();
    let base = std::path::PathBuf::from(vex_term_cwd());
    let target = if std::path::Path::new(&rel).is_absolute() {
        std::path::PathBuf::from(&rel)
    } else {
        base.join(&rel)
    };
    if !target.exists() {
        return Err(format!("cd: directory not found: {}", rel));
    }
    if !target.is_dir() {
        return Err(format!("cd: not a directory: {}", rel));
    }
    let abs = target
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| target.to_string_lossy().to_string());
    VEX_TERM_DIR.with(|d| {
        *d.borrow_mut() = Some(abs);
    });
    Ok(VexVal::Null)
}

fn vex_spawn_shell(cmd: &str, cwd: &str) -> Result<std::process::Output, String> {
    let (sh, flag) = if cfg!(windows) { ("cmd", "/C") } else { ("sh", "-c") };
    std::process::Command::new(sh)
        .arg(flag)
        .arg(cmd)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("run: cannot execute '{}': {}", cmd, e))
}

fn vex_term_exec(cmd: &VexVal) -> Result<(String, String), String> {
    let c = cmd.to_display();
    let cwd = vex_term_cwd();
    let out = vex_spawn_shell(&c, &cwd)?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() {
        let code = out
            .status
            .code()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "?".to_string());
        let tail = stderr.trim();
        return Err(format!(
            "run exited with code {}: {}{}",
            code,
            c,
            if tail.is_empty() { String::new() } else { format!(" ({})", tail) }
        ));
    }
    Ok((stdout, stderr))
}

pub fn vex_term_run_print(cmd: &VexVal) -> Result<VexVal, String> {
    let (stdout, stderr) = vex_term_exec(cmd)?;
    if !stdout.is_empty() {
        print!("{}", stdout);
        let _ = std::io::stdout().flush();
    }
    if !stderr.is_empty() {
        eprint!("{}", stderr);
    }
    Ok(VexVal::Null)
}

pub fn vex_term_run_capture(cmd: &VexVal) -> Result<VexVal, String> {
    let (stdout, stderr) = vex_term_exec(cmd)?;
    if !stderr.is_empty() {
        eprint!("{}", stderr);
    }
    Ok(VexVal::Str(stdout))
}

// ===== Vexel 2.9: filesystem (files + directories) =====

pub fn vex_file_write(val: &VexVal, path: &str) -> Result<VexVal, String> {
    match std::fs::write(path, val.to_display()) {
        Ok(()) => Ok(VexVal::Null),
        Err(e) => Err(format!("Cannot write file '{}': {}", path, e)),
    }
}

pub fn vex_file_append(val: &VexVal, path: &str) -> Result<VexVal, String> {
    match std::fs::OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut f) => match f.write_all(val.to_display().as_bytes()) {
            Ok(()) => Ok(VexVal::Null),
            Err(e) => Err(format!("Cannot append to file '{}': {}", path, e)),
        },
        Err(e) => Err(format!("Cannot append to file '{}': {}", path, e)),
    }
}

pub fn vex_file_read(path: &str) -> Result<VexVal, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(VexVal::Str(contents)),
        Err(_) => Err(format!("File not found: {}", path)),
    }
}

pub fn vex_file_delete(path: &str) -> Result<VexVal, String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(VexVal::Null),
        Err(e) => Err(format!("Cannot delete file '{}': {}", path, e)),
    }
}

pub fn vex_file_copy(from: &str, to: &str) -> Result<VexVal, String> {
    match std::fs::copy(from, to) {
        Ok(_) => Ok(VexVal::Null),
        Err(e) => Err(format!("Cannot copy file '{}' to '{}': {}", from, to, e)),
    }
}

pub fn vex_file_move(from: &str, to: &str) -> Result<VexVal, String> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(VexVal::Null),
        Err(_) => match std::fs::copy(from, to) {
            Ok(_) => match std::fs::remove_file(from) {
                Ok(()) => Ok(VexVal::Null),
                Err(e) => Err(format!("Cannot move file '{}' to '{}': {}", from, to, e)),
            },
            Err(e) => Err(format!("Cannot move file '{}' to '{}': {}", from, to, e)),
        },
    }
}

pub fn vex_file_exists(path: &str) -> VexVal {
    VexVal::Bool(std::path::Path::new(path).is_file())
}

pub fn vex_file_size(path: &str) -> Result<VexVal, String> {
    match std::fs::metadata(path) {
        Ok(m) => {
            if !m.is_file() {
                return Err(format!("Not a file: {}", path));
            }
            Ok(VexVal::Int(m.len() as i64))
        }
        Err(_) => Err(format!("File not found: {}", path)),
    }
}

pub fn vex_dir_create(path: &str) -> Result<VexVal, String> {
    match std::fs::create_dir_all(path) {
        Ok(()) => Ok(VexVal::Null),
        Err(e) => Err(format!("Cannot create directory '{}': {}", path, e)),
    }
}

pub fn vex_dir_delete(path: &str) -> Result<VexVal, String> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(VexVal::Null),
        Err(e) => Err(format!("Cannot delete directory '{}': {}", path, e)),
    }
}

pub fn vex_dir_exists(path: &str) -> VexVal {
    VexVal::Bool(std::path::Path::new(path).is_dir())
}

pub fn vex_dir_list(path: &str) -> Result<VexVal, String> {
    match std::fs::read_dir(path) {
        Ok(entries) => {
            let mut names: Vec<String> = Vec::new();
            for e in entries {
                match e {
                    Ok(en) => names.push(en.file_name().to_string_lossy().to_string()),
                    Err(e) => return Err(format!("Cannot list directory '{}': {}", path, e)),
                }
            }
            names.sort();
            Ok(VexVal::List(Rc::new(RefCell::new(
                names.into_iter().map(VexVal::Str).collect(),
            ))))
        }
        Err(_) => Err(format!("Directory not found: {}", path)),
    }
}

fn vex_copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    if !from.is_dir() {
        return Err(format!("Not a directory: {}", from.to_string_lossy()));
    }
    std::fs::create_dir_all(to)
        .map_err(|e| format!("Cannot create directory '{}': {}", to.to_string_lossy(), e))?;
    let entries =
        std::fs::read_dir(from).map_err(|e| format!("Cannot list directory '{}': {}", from.to_string_lossy(), e))?;
    for e in entries {
        let e = e.map_err(|e| format!("Cannot list directory '{}': {}", from.to_string_lossy(), e))?;
        let src = e.path();
        let dst = to.join(e.file_name());
        if src.is_dir() {
            vex_copy_dir_recursive(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)
                .map_err(|e| format!("Cannot copy file '{}': {}", src.to_string_lossy(), e))?;
        }
    }
    Ok(())
}

pub fn vex_dir_copy(from: &str, to: &str) -> Result<VexVal, String> {
    vex_copy_dir_recursive(std::path::Path::new(from), std::path::Path::new(to))?;
    Ok(VexVal::Null)
}

pub fn vex_dir_move(from: &str, to: &str) -> Result<VexVal, String> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(VexVal::Null),
        Err(_) => {
    vex_copy_dir_recursive(std::path::Path::new(from), std::path::Path::new(to))?;
            std::fs::remove_dir_all(from)
                .map_err(|e| format!("Cannot move directory '{}' to '{}': {}", from, to, e))?;
            Ok(VexVal::Null)
        }
    }
}

// ===== Atlas v0.1 lives in runtime/atlas.rs =====
// (concatenated after this file by the compiler driver; see loadRuntime
// in compiler/codegen/codegen.js. VexTensor is defined there.)


















