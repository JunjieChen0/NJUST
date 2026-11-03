package calculator

import std.unittest.*
import std.unittest.testmacro.*

@Test
class BoundedTest {
    @TestCase
    func preservesPositiveValue(): Unit {
        @Expect(bounded(7), 7)
    }

    @TestCase
    func clampsNegativeValue(): Unit {
        @Expect(bounded(-2), 0)
    }
}
