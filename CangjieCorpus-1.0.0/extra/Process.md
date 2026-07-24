# Process

Use this card before implementing process helpers. Confirm details in `libs/std/process/process_package_api/process_package_funcs.md` and `libs/std/process/process_samples/`.

## Import

```cangjie
import std.process.*
```

Use `std.fs.*` for `Path` and `std.io.*` when reading process pipes with `StringReader`.

## Run and wait for exit

```cangjie
let code: Int64 = execute("echo", ["hello"])
```

`execute(command: String, arguments: Array<String>, ...): Int64` starts a child process, waits for it, and returns the exit code.

## Run and capture output

```cangjie
let (code, outBytes, errBytes) = executeWithOutput("echo", ["hello"])
let outText = String.fromUtf8(outBytes)
let errText = String.fromUtf8(errBytes)
```

`executeWithOutput(...): (Int64, Array<Byte>, Array<Byte>)` returns exit code, stdout bytes, and stderr bytes. Convert byte arrays with `String.fromUtf8`.

## Launch long-running subprocess

```cangjie
let proc: SubProcess = launch("sleep", ["10s"], stdOut: ProcessRedirect.Pipe)
let code: Int64 = proc.wait()
```

Always call `wait`, `waitOutput`, or terminate and wait after `launch`; otherwise subprocess resources may not be reclaimed.

## Platform note

Some bundled examples use Linux commands such as `sleep` and explicitly do not support Windows. For portable helpers, make the command and arguments configurable instead of hard-coding Linux-only commands.
