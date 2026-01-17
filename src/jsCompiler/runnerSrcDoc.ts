export function runnerSrcDoc(): string {
  // Keep this HTML self-contained so we can mount it via iframe srcDoc.
  // Sandbox: allow-scripts only (opaque origin). postMessage still works.
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JSCompiler Runner</title>
  </head>
  <body>
    <script>
      (function () {
        function safeStringify(value) {
          const seen = new WeakSet();
          try {
            return JSON.stringify(value, function (key, val) {
              if (typeof val === 'object' && val !== null) {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
              }
              if (typeof val === 'bigint') return String(val);
              return val;
            });
          } catch (e) {
            try { return String(value); } catch (e2) { return '[Unserializable]'; }
          }
        }

        function serializeArg(arg) {
          if (typeof arg === 'string') return arg;
          if (arg === null) return 'null';
          if (arg === undefined) return 'undefined';
          if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') return String(arg);
          if (arg instanceof Error) return arg.stack || arg.message || 'Error';
          return safeStringify(arg);
        }

        function post(msg) {
          try {
            window.parent.postMessage(msg, '*');
          } catch (e) {
            // ignore
          }
        }

        const original = {};
        ['log','info','warn','error','debug'].forEach(function (level) {
          original[level] = console[level] ? console[level].bind(console) : function () {};
          console[level] = function () {
            const args = Array.prototype.slice.call(arguments);
            post({ type: 'CONSOLE', level: level, args: args.map(serializeArg), runId: window.__RUN_ID__ || '' });
            try { original[level].apply(console, args); } catch (e) {}
          };
        });

        window.addEventListener('error', function (event) {
          const err = event && event.error;
          post({
            type: 'RUNTIME_ERROR',
            message: String((event && event.message) || (err && err.message) || 'Uncaught error'),
            stack: (err && err.stack) ? String(err.stack) : undefined,
            runId: window.__RUN_ID__ || ''
          });
        });

        window.addEventListener('unhandledrejection', function (event) {
          const reason = event && event.reason;
          const message =
            reason instanceof Error ? (reason.message || 'Unhandled promise rejection')
            : typeof reason === 'string' ? reason
            : safeStringify(reason);
          const stack = reason instanceof Error && reason.stack ? String(reason.stack) : undefined;
          post({ type: 'UNHANDLED_REJECTION', message: message, stack: stack, runId: window.__RUN_ID__ || '' });
        });

        window.addEventListener('message', function (event) {
          const data = event && event.data;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'RESET') {
            // noop for now (parent remounts iframe per run)
            return;
          }
          if (data.type !== 'RUN') return;
          window.__RUN_ID__ = String(data.runId || '');
          try {
            // Execute user code in this isolated realm.
            (new Function(String(data.code || '')))();
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            post({ type: 'RUNTIME_ERROR', message: err.message || 'Runtime error', stack: err.stack, runId: window.__RUN_ID__ || '' });
          }
        });

        post({ type: 'READY' });
      })();
    </script>
  </body>
</html>`;
}

