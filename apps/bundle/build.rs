// Вшивает значок и сведения о программе в сам exe: их видно в проводнике и в
// свойствах файла.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let mut res = winresource::WindowsResource::new();
    res.set_icon("../desktop/build/icon.ico");
    res.set("ProductName", "ГимРум");
    res.set("FileDescription", "ГимРум — мессенджер Кировской гимназии");
    res.set("CompanyName", "МБОУ Кировская Гимназия");
    let _ = res.compile();
}
