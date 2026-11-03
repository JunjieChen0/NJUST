# Order calculation fixture 1.0.0

Amounts are integer cents. The application calls a local `pricing` dependency and the
`orders.shipping` subpackage. Empty orders cost zero; other orders include a 500-cent
shipping fee. `test-data/orders.csv` contains example acceptance inputs; it is also
part of the verification fingerprint.

Run `cjpm build` and `cjpm test` at the directory containing this manifest.
