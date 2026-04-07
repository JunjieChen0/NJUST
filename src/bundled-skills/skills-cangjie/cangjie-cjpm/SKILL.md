---
name: cangjie-cjpm
description: "Provides guidance on Cangjie's Project Manager (cjpm), dependency management, configuration files (cjpm.toml), workspaces, and build/test commands. Invoke when the user asks about adding dependencies, compiling projects, configuring cjpm.toml, resolving circular dependencies, or workspace setups."
modeSlugs:
  - cangjie
---

# Cangjie Project Manager (cjpm) Guide

`cjpm` (Cangjie Project Manager) is the official project management, build system, and package manager for the Cangjie programming language. It is analogous to Cargo for Rust or npm for Node.js.

## Common CLI Commands

- `cjpm init`: Initialize a new project. 
  - `--name <value>`: Specify root package name (default is folder name).
  - `--path <value>`: Specify project initialize path.
  - `--type=<executable|static|dynamic>`: Generate specified type of library instead of executable.
  - `--workspace`: Create a workspace `cjpm.toml`.
- `cjpm build`: Compiles the current module.
  - `-V` or `--verbose`: Show detailed compilation logs (traces the `cjc` commands invoked).
  - `-g`: Emit debug compilation outputs.
  - `-i` / `--incremental`: Enable module-level incremental compilation.
  - `-j` / `--jobs <N>`: Specify parallel compilation concurrency.
  - `--coverage`: Generate coverage information.
- `cjpm run`: Builds and runs an executable project.
  - `-- [args]`: Passes arguments to the executable. Example: `cjpm run -- a b c`
  - `-g`: Emit and run the debug compilation outputs.
- `cjpm test`: Compiles and runs unit tests (`*_test.cj` files).
  - `--coverage`: Generate coverage information.
  - `--filter=*MyClassTest.*`: Run tests that match a filter.
  - `--include-tags=Unittest`: Run tests by Tag (uses the `@Tag` macro in code).
- `cjpm bench`: Compiles and runs benchmark tests annotated with `@Bench`.
- `cjpm clean`: Cleans up the `target` build directory.
- `cjpm check`: Checks project dependencies and validates the build order.
- `cjpm tree`: Visualizes the dependency tree. 
  - `--depth <N>`: Specify maximum depth of dependency tree.
  - `--invert [pkg_name]`: View what depends on a specific package.
- `cjpm update`: Updates `cjpm.lock` to lock dependency versions based on `cjpm.toml`.
- `cjpm install`: Installs the compiled executable project to a specified path (`~/.cjpm` by default).
  - `--path <value>`: Install a local project module.
  - `--git <url>`: Install from a git repository.
- `cjpm uninstall`: Uninstalls a previously installed Cangjie project.

> **Note on Circular Dependencies**: If `cjpm build` throws a `cyclic dependency` error, you must resolve the circular import tree by removing redundant imports, refactoring shared code into a common package, or using the `combine-all-deps = true` feature where applicable.

---

## `cjpm.toml` Configuration File

The `cjpm.toml` file stores project metadata and dependencies.

### 1. `[package]` Section
Used for single-module repositories. **Cannot** coexist with a `[workspace]` block in the same file.

```toml
[package]
cjc-version = "1.0.0"          # Minimum Cangjie Compiler (cjc) version required (Required)
name = "my_project"            # Module name and root package name (Required)
version = "1.0.0"              # Module version (Required)
description = "A description"  # Optional
output-type = "executable"     # "executable", "static", or "dynamic" (Required)
compile-option = "-O2"         # Extra compiler options passed to cjc
override-compile-option = ""   # Global compiler options that override defaults and propagate to dependencies
link-option = ""               # Extra linker options (e.g. "-z noexecstack")
src-dir = "src"                # Source directory (default is "src")
target-dir = "target"          # Build directory (default is "target")
```

### 2. `[dependencies]` Section
Dependencies can be linked locally or fetched from a Git repository. 

```toml
[dependencies]
# 1. Local path dependency
utils = { path = "../utils" }
# You can force the output type of a dependency:
lib_dynamic = { path = "../dynamic_lib", output-type = "dynamic" }

# 2. Remote git dependency
# Can specify a branch, tag, or commit. Precedence: commit > branch > tag.
net_tools = { git = "https://gitee.com/cangjie/net_tools", branch = "dev" }
crypto    = { git = "https://github.com/cangjie/crypto", tag = "v1.0" }
```

### 3. Other Dependencies Sections
- `[test-dependencies]`: Dependencies only available to tests (`*_test.cj`). Will not be bundled in the production build.
- `[script-dependencies]`: Dependencies specifically used for the build script (`build.cj`), if your project has one.
- `[replace]`: Used to override an indirect dependency globally. Identical schema to dependencies. Only valid in the root `cjpm.toml`.

Example `[replace]`:
```toml
[dependencies]
libA = { path = "./libA" }    # libA depends on libB internally

[replace]
# Replaces any indirect dependency of libB with our patched version
libB = { path = "./patched_libB" } 
```

### 4. `[ffi.c]` Section (C Language Interop)
Used to embed configurations for C code interoperability. Instructs `cjpm` where to search for external C libraries.

```toml
[ffi.c]
clib = { path = "./native_libs" }
```
In Cangjie, you will need to annotate external C functions with `@Foreign[C]`.

### 5. `[workspace]` Section
Workspaces allow multiple modules to share the same dependencies and settings. A `cjpm.toml` with `[workspace]` **cannot** contain a `[package]` declaration.

```toml
[workspace]
members = ["submodule1", "path/to/submodule2"] # Required
build-members = ["submodule1"]                 # Only builds these when `cjpm build` is run from the workspace root
compile-option = "-O2"                         # Applied to all member modules
```

---

## Output Types & Combined Configurations

When creating libraries, `cjpm` builds packages into static `.a` files or dynamic `.so`/`.dll` files based on the `[package.package-configuration]` configurations or the `combined` settings.

### Custom Package Configurations
You can specify `output-type` and `compile-option` for specific subpackages:
```toml
[package.package-configuration."my_project.sub_package"]
output-type = "dynamic"
compile-option = "-g"
combine-all-deps = true # Project-level compilation artifact merging (only for root module)
```

### Profile Builds (LTO & Combined)
The `[profile]` table lets you customize command defaults.

```toml
[profile.build]
lto = "full"               # "full" or "thin" for Link-Time Optimization (Linux only)
incremental = true         # Incremental compilation flag
performance_analysis = true # Generates compilation time and memory usage (.prof / .json)

[profile.build.combined]
# Merges the entire module into a single dynamic library for distribution.
# The key is the module name ("demo" here), the value is "dynamic"
demo = "dynamic"

[profile.customized-option]
cfg1 = "--cfg=\"feature1=lion, feature2=cat\"" # Used with `cjpm build --cfg1`
```

### Test/Bench Command Options in `cjpm.toml`
```toml
[profile.test]
parallel = true       # Run tests in parallel (threads = logical CPU cores)
timeout-each = "5s"   # 5 second timeout for each test
report-format = "xml" # Outputs a JUnit-style XML report

[profile.test.env]
# Inject environment variables during execution
MY_VAR = { value = "hello_world", splice-type = "replace" }

[profile.bench]
report-format = "csv" # Bench reports output in CSV
```

## Multi-Target Configuration (Cross-compilation)
You can assign specific dependencies and flags for a targeted OS and architecture.

```toml
[target.x86_64-w64-mingw32.dependencies]
# This dependency is ONLY fetched and compiled when building for Windows x86_64
windows-api = { path = "./windows_wrapper" }

[target.x86_64-unknown-linux-gnu]
# Applies extra flags for linux targets
compile-option = "-D LINUX"

[target.x86_64-unknown-linux-gnu.bin-dependencies]
# Imports pre-compiled binary dependencies (`.cjo` and `.so`/`.a` files)
path-option = ["./libs/pro1"]
```

## Creating Executable Outputs in Sub-Packages
It is generally recommended that the root package contains the `main` entry point. However, if you need to create multiple executable entry points, you can do so by explicitly labelling certain subpackages as an executable:

```toml
[package.package-configuration."demo.binary_one"]
output-type = "executable"

[package.package-configuration."demo.binary_two"]
output-type = "executable"
```

When building, executing `tree target/release/bin` will show binaries built separately for `binary_one` and `binary_two`.
