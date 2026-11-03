package orders

import pricing.discountedSubtotal
import orders.shipping.shippingFee

public func orderTotal(unitPrice: Int64, quantity: Int64): Int64 {
    discountedSubtotal(unitPrice, quantity) + shippingFee(quantity)
}
