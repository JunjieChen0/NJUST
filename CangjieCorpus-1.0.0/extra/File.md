# File

Use this card before implementing simple file helpers. Confirm details in `libs/std/fs/fs_samples/file_samples.md` and `libs/std/fs/fs_package_api/fs_package_classes.md`.

## Imports

```cangjie
import std.fs.*
```

## Read an entire file

```cangjie
let bytes: Array<Byte> = File.readFrom("./input.txt")
let text: String = String.fromUtf8(bytes)
```

`File.readFrom(path: String)` and `File.readFrom(path: Path)` return `Array<Byte>`. Convert bytes to text with `String.fromUtf8`.

When explaining this pattern, cite the sample usage above or a successful build. Do not infer or describe undocumented `Byte`/`UInt8` type compatibility beyond the evidence you have.
If you compare isolated signatures and notice `Array<Byte>` vs `Array<UInt8>`, do not report a risk from that comparison alone. First cite `libs/std/fs/fs_samples/file_samples.md`, which demonstrates this exact read-and-decode pattern.

## Write an entire file

```cangjie
File.writeTo("./output.txt", "hello\n".toArray())
```

`File.writeTo` overwrites the target file. Use explicit `File(path, Read)`, `File(path, Write)`, `File(path, Append)`, or `File(path, ReadWrite)` when the task needs streaming, seeking, or appending.

## Resource rule

If you create a `File` object directly, close it after use:

```cangjie
var file: File = File("./input.txt", Read)
let buf: Array<Byte> = readToEnd(file)
file.close()
```
