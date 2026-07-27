# Regex

Use this card before implementing regex helpers. Confirm details in `libs/std/regex/regex_samples/regex_sample.md` and `libs/std/regex/regex_package_api/regex_package_classes.md`.

## Import and construction

```cangjie
import std.regex.*

let r = Regex(#"\d+"#)
```

Use raw string syntax such as `#"\d+"#` or `##"..."##` for patterns that contain backslashes.
For digit extraction examples, prefer `Regex(#"\d+"#)` over `Regex("\\d+")`.

## Boolean match

```cangjie
let ok: Bool = Regex(#"\d+"#).matches("abc123")
```

`matches(input: String): Bool` checks whether the input contains a match.

## Find match data

```cangjie
match (Regex(#"\d+"#).find("abc123")) {
    case Some(md) => println(md.matchString())
    case None => println("None")
}
```

`find(input: String, group!: Bool = false): Option<MatchData>` returns the first match. Related APIs return `Option<MatchData>` or collections of `MatchData`; handle `Some` and `None` explicitly.

## Replace and split

```cangjie
let r = Regex(#"\d+"#)
let redacted: String = r.replaceAll("a1b22", "X")
let parts: Array<String> = Regex("&").split("a&b&c")
```
