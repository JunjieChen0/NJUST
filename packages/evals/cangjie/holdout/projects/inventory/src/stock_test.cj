package inventory
import std.unittest.*
import std.unittest.testmacro.*
@Test class AcceptanceTest {
    @TestCase func checks(): Unit {
        @Expect(available(10, 3), 7)
        @Expect(available(3, 10), 0)
        @Expect(canReserve(10, 3, 7), true)
        @Expect(canReserve(10, 3, 8), false)
        @Expect(canReserve(10, 3, 0), false)
        @Expect(replenishment(5, 0, 10), 5)
    }
}
