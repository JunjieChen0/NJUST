package pricing

import std.unittest.*
import std.unittest.testmacro.*

@Test
class PricingTest {
    @TestCase
    func calculatesSubtotal(): Unit {
        @Expect(discountedSubtotal(199, 3), 597)
    }
}
