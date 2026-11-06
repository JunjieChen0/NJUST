package textstats
import std.unittest.*
import std.unittest.testmacro.*
@Test class AcceptanceTest {
    @TestCase func checks(): Unit {
        @Expect(wordCount("a  b"), 2)
        @Expect(wordCount(""), 0)
        @Expect(countExact("a b a", "a"), 2)
        @Expect(countExact("a b", "z"), 0)
    }
}
