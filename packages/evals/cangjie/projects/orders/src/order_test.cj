package orders

import std.unittest.*
import std.unittest.testmacro.*

@Test
class OrderTest {
    @TestCase
    func includesShipping(): Unit {
        @Expect(orderTotal(100, 2), 700)
    }

    @TestCase
    func emptyOrderHasNoCost(): Unit {
        @Expect(orderTotal(100, 0), 0)
    }
}
