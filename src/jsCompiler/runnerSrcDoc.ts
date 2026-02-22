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
        const MAX_DEPTH = 3;
        const MAX_ITEMS = 50;

        function quoteString(value) {
          try {
            return JSON.stringify(String(value));
          } catch (e) {
            return '"[Unserializable]"';
          }
        }

        function isIdentifierName(name) {
          return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
        }

        function inspectValue(value, depth, seen) {
          if (value === null) return 'null';
          const type = typeof value;
          if (type === 'string') return quoteString(value);
          if (type === 'number') {
            if (Number.isNaN(value)) return 'NaN';
            if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
            return String(value);
          }
          if (type === 'boolean' || type === 'undefined') return String(value);
          if (type === 'bigint') return String(value) + 'n';
          if (type === 'symbol') return String(value);
          if (type === 'function') return value.name ? '[Function: ' + value.name + ']' : '[Function]';

          if (seen.has(value)) return '[Circular]';
          if (depth <= 0) return Array.isArray(value) ? '[Array]' : '[Object]';

          seen.add(value);
          try {
            if (value instanceof Error) return value.stack || value.message || 'Error';
            if (value instanceof Date) {
              return Number.isNaN(value.getTime()) ? 'Invalid Date' : 'Date ' + quoteString(value.toISOString());
            }
            if (value instanceof RegExp) return String(value);
            if (Array.isArray(value)) {
              const result = [];
              const limit = Math.min(value.length, MAX_ITEMS);
              for (let i = 0; i < limit; i += 1) {
                if (i in value) result.push(inspectValue(value[i], depth - 1, seen));
                else result.push('<empty>');
              }
              if (value.length > MAX_ITEMS) {
                result.push('... ' + String(value.length - MAX_ITEMS) + ' more items');
              }
              return '[' + result.join(', ') + ']';
            }
            if (value instanceof Map) {
              const entries = [];
              let count = 0;
              value.forEach(function (v, k) {
                if (count >= MAX_ITEMS) return;
                entries.push(inspectValue(k, depth - 1, seen) + ' => ' + inspectValue(v, depth - 1, seen));
                count += 1;
              });
              if (value.size > MAX_ITEMS) entries.push('... ' + String(value.size - MAX_ITEMS) + ' more entries');
              return 'Map(' + String(value.size) + ') {' + entries.join(', ') + '}';
            }
            if (value instanceof Set) {
              const entries = [];
              let count = 0;
              value.forEach(function (v) {
                if (count >= MAX_ITEMS) return;
                entries.push(inspectValue(v, depth - 1, seen));
                count += 1;
              });
              if (value.size > MAX_ITEMS) entries.push('... ' + String(value.size - MAX_ITEMS) + ' more entries');
              return 'Set(' + String(value.size) + ') {' + entries.join(', ') + '}';
            }

            const keys = Object.getOwnPropertyNames(value);
            const symbols = Object.getOwnPropertySymbols ? Object.getOwnPropertySymbols(value) : [];
            const parts = [];

            for (let i = 0; i < keys.length; i += 1) {
              const key = keys[i];
              if (parts.length >= MAX_ITEMS) {
                parts.push('... ' + String(keys.length + symbols.length - MAX_ITEMS) + ' more properties');
                break;
              }

              const descriptor = Object.getOwnPropertyDescriptor(value, key);
              if (!descriptor) continue;
              const label = isIdentifierName(key) ? key : quoteString(key);
              if ('value' in descriptor) {
                parts.push(label + ': ' + inspectValue(descriptor.value, depth - 1, seen));
              } else if (descriptor.get && descriptor.set) {
                parts.push(label + ': [Getter/Setter]');
              } else if (descriptor.get) {
                parts.push(label + ': [Getter]');
              } else if (descriptor.set) {
                parts.push(label + ': [Setter]');
              }
            }

            for (let i = 0; i < symbols.length; i += 1) {
              if (parts.length >= MAX_ITEMS) {
                parts.push('... ' + String(keys.length + symbols.length - MAX_ITEMS) + ' more properties');
                break;
              }
              const symbol = symbols[i];
              const descriptor = Object.getOwnPropertyDescriptor(value, symbol);
              if (!descriptor) continue;
              const label = '[' + String(symbol) + ']';
              if ('value' in descriptor) {
                parts.push(label + ': ' + inspectValue(descriptor.value, depth - 1, seen));
              } else if (descriptor.get && descriptor.set) {
                parts.push(label + ': [Getter/Setter]');
              } else if (descriptor.get) {
                parts.push(label + ': [Getter]');
              } else if (descriptor.set) {
                parts.push(label + ': [Setter]');
              }
            }

            return '{' + parts.join(', ') + '}';
          } catch (e) {
            try {
              return String(value);
            } catch (e2) {
              return '[Unserializable]';
            }
          } finally {
            seen.delete(value);
          }
        }

        function safeInspect(value) {
          try {
            return inspectValue(value, MAX_DEPTH, new WeakSet());
          } catch (e) {
            try { return String(value); } catch (e2) { return '[Unserializable]'; }
          }
        }

        function serializeArg(arg) {
          if (typeof arg === 'string') return arg;
          if (arg === null) return 'null';
          if (arg === undefined) return 'undefined';
          if (typeof arg === 'number') return inspectValue(arg, MAX_DEPTH, new WeakSet());
          if (typeof arg === 'boolean') return String(arg);
          if (typeof arg === 'bigint') return String(arg) + 'n';
          if (arg instanceof Error) return arg.stack || arg.message || 'Error';
          return safeInspect(arg);
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
            : safeInspect(reason);
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
