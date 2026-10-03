{ pkgs }: {
  deps = [
    pkgs.nodejs
    pkgs.rustc
    pkgs.cargo
    pkgs.gcc
  ];
}
