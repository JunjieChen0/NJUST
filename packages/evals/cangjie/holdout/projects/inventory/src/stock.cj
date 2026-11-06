package inventory

public func available(stock: Int64, reserved: Int64): Int64 {
    let free = stock - reserved
    if (free < 0) { 0 } else { free }
}

public func canReserve(stock: Int64, reserved: Int64, requested: Int64): Bool {
    requested > 0 && requested <= available(stock, reserved)
}

public func replenishment(stock: Int64, reserved: Int64, target: Int64): Int64 {
    if (stock >= target) { 0 } else { target - stock }
}
