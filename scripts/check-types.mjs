import ts from "typescript";
import { resolve } from "node:path";

const configPath = ts.findConfigFile(
  process.cwd(),
  ts.sys.fileExists,
  "tsconfig.json",
);
if (!configPath) throw new Error("Missing tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  process.cwd(),
  { noCheck: false, noEmit: true },
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
// BlockSuite exports TypeScript source with upstream diagnostics. Check every
// project file and global/config diagnostic; do not suppress project errors.
const diagnostics = [
  ...(config.error ? [config.error] : []),
  ...parsed.errors,
  ...ts.getPreEmitDiagnostics(program),
].filter(
  (diagnostic) =>
    !diagnostic.file ||
    !resolve(diagnostic.file.fileName).split(/[/\\]/).includes("node_modules"),
);
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getCanonicalFileName: (name) => name,
      getNewLine: () => ts.sys.newLine,
    }),
  );
  process.exitCode = 1;
}
