package textstats

public func wordCount(text: String): Int64 {
    text.split(" ", removeEmpty: true).size
}

public func countExact(text: String, needle: String): Int64 {
    var count: Int64 = 0
    for (word in text.split(" ", removeEmpty: true)) {
        if (word == needle) { count++ }
    }
    count
}
