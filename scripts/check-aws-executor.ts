/**
 * Verify the AWS Lambda code executor end to end through the app's own client (SigV4-signed Invoke).
 *   CODE_EXECUTOR=aws-lambda AWS_REGION=… AWS_LAMBDA_FUNCTION=hbe-executor AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… npx tsx scripts/check-aws-executor.ts
 * Against the local Lambda Runtime Interface Emulator: AWS_LAMBDA_ENDPOINT=http://localhost:8080 AWS_LAMBDA_FUNCTION=function
 * LANGS=javascript limits the languages (the emulator image used in CI-less sandboxes only has Node.js).
 */
import "./load-env";

process.env.CODE_EXECUTOR = "aws-lambda";

const SOLUTIONS: Record<string, string> = {
  python: "a, b = map(int, input().split())\nprint(a + b)\n",
  javascript: "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(' ').map(Number);\nconsole.log(a + b);\n",
  java: "import java.util.*;\npublic class Main { public static void main(String[] x) { Scanner s = new Scanner(System.in); System.out.println(s.nextLong() + s.nextLong()); } }\n",
  cpp: "#include <iostream>\nint main(){ long long a,b; std::cin>>a>>b; std::cout<<a+b<<\"\\n\"; }\n",
};
const tests = [
  { input: "1 2", output: "3" },
  { input: "40 2", output: "42" },
  { input: "-5 5", output: "0" },
];

async function main() {
  const { executeTests } = await import("../src/lib/exec");
  const langs = (process.env.LANGS ?? "python,javascript,java,cpp").split(",") as ("python" | "javascript" | "java" | "cpp")[];
  let ok = true;
  for (const lang of langs) {
    const good = await executeTests(lang, SOLUTIONS[lang], tests, { revealIO: true });
    const bad = await executeTests(lang, lang === "python" ? "print(0)" : lang === "javascript" ? "console.log(0)" : SOLUTIONS[lang].replace("a + b", "a - b").replace("a+b", "a-b").replace("s.nextLong() + s.nextLong()", "0"), tests, { revealIO: false });
    const pass = good.passed === tests.length && bad.passed < tests.length && !good.unavailable;
    ok &&= pass;
    console.log(`${pass ? "✓" : "✗"} ${lang}: correct ${good.passed}/${good.total}, wrong ${bad.passed}/${bad.total}${good.unavailable ? ` (${good.unavailable})` : ""}${good.compileError ? ` CE: ${good.compileError.slice(0, 200)}` : ""}`);
  }
  const tle = await executeTests("javascript", "while (true) {}", [{ input: "", output: "x" }], { revealIO: true });
  console.log(`${tle.results[0]?.verdict === "TLE" ? "✓" : "✗"} infinite loop → ${tle.results[0]?.verdict ?? tle.unavailable}`);
  ok &&= tle.results[0]?.verdict === "TLE";
  console.log(ok ? "\nAWS EXECUTOR CHECK PASSED" : "\nAWS EXECUTOR CHECK FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
