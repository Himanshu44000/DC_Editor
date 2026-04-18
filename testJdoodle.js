import dotenv from 'dotenv';
import { executeWithJdoodle } from './server/execution/providerRouting.js';

dotenv.config();

async function runTest() {
  const snippets = [
    {
      runtime: 'java',
      sourceCode: 'public class Main { public static void main(String[] args) { System.out.println("DC Editor"); } }'
    },
    {
      runtime: 'typescript',
      sourceCode: 'console.log("TS: Hello world");'
    }
  ];

  for (const snippet of snippets) {
    try {
      const result = await executeWithJdoodle(snippet);
      const output = {
        runtime: snippet.runtime,
        ok: result.ok,
        statusCode: result.statusCode,
        errorCategory: result.errorCategory,
        stderr: result.stderr ? String(result.stderr).substring(0, 220) : '',
        jdoodleLanguage: result.jdoodleLanguage,
        jdoodleVersionIndex: result.jdoodleVersionIndex
      };
      console.log(JSON.stringify(output));
    } catch (err) {
      console.log(JSON.stringify({
        runtime: snippet.runtime,
        ok: false,
        errorCategory: 'script_error',
        stderr: String(err.message).substring(0, 220)
      }));
    }
  }
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
