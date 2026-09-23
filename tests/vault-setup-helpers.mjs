export async function createFirstVault(js, until) {
  await until(
    () => js('Boolean(document.querySelector(".vault-setup form"))'),
    "First-run setup did not appear",
  );
  await js('document.querySelector(".vault-setup form").requestSubmit()');
  await until(
    () => js('Boolean(document.querySelector("doc-title")?.doc?.root)'),
    "New vault editor did not open",
  );
  return js(
    'window.hyperionDesktop.repositoryExecute({operation:"listVaults"}).then(vaults=>vaults[0].id)',
  );
}
