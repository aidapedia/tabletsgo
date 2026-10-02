#!/usr/bin/env node
// PostToolUse hook: when an edit to server.js adds/changes an express route,
// remind the agent of the CLAUDE.md "EXTRA ACTION" rule (document it in
// BACKEND_DOCUMENTATION.MD). Stays silent for every other edit.
//
// Reads the hook payload as JSON on stdin; prints a hook JSON result on stdout.

let raw = '';
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const toolInput = input.tool_input || {};
    const file = toolInput.file_path || '';
    // Edit sends new_string; Write sends content.
    const text = toolInput.new_string ?? toolInput.content ?? '';

    const touchesRoutes = /(^|\/)server\.js$/.test(file) || /(^|\/)server\/routes\//.test(file);
    const declaresRoute = /\b(?:app|router)\.(?:get|post|put|patch|delete|all)\s*\(/.test(text);

    if (touchesRoutes && declaresRoute) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext:
              'This edit touched express route definitions. Per CLAUDE.md > EXTRA ACTION: ' +
              'if you added or changed an endpoint, document its request/response shape and a ' +
              'sample URL in BACKEND_DOCUMENTATION.MD, and update README.md if the feature set changed.',
          },
        }),
      );
    }
  } catch {
    // A malformed payload must never break the tool call — stay silent.
  }
});
