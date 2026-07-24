# Time

Use this card before implementing date/time helpers. Confirm details in `libs/std/time/time_samples/` and `libs/std/time/time_package_api/time_package_structs.md`.

## Import

```cangjie
import std.time.*
```

## Current time

```cangjie
let localNow: DateTime = DateTime.now()
let utcNow: DateTime = DateTime.nowUTC()
```

`DateTime.now(timeZone!: TimeZone = TimeZone.Local)` returns `DateTime`. It is affected by system time. For monotonic measurement, use `MonoTime.now()`.

## Construct with a time zone

```cangjie
let dt = DateTime.of(
    year: 2024,
    month: May,
    dayOfMonth: 22,
    hour: 12,
    minute: 34,
    second: 56,
    nanosecond: 789000000,
    timeZone: TimeZone.load("Asia/Shanghai")
)
```

`TimeZone.load(id: String): TimeZone` loads an IANA time zone such as `"Asia/Shanghai"`.

## Format and parse

```cangjie
let pattern = "yyyy/MM/dd HH:mm:ssSSS OO"
let text: String = dt.format(pattern)
let parsed: DateTime = DateTime.parse(text, pattern)
```

`DateTime.parse(str: String)` parses the default date-time format. `DateTime.parse(str: String, format: String)` parses with a pattern.

## Common properties

```cangjie
let yr = dt.year
let mon = dt.month
let day = dt.dayOfMonth
let zone = dt.zoneId
let offset = dt.zoneOffset
```
