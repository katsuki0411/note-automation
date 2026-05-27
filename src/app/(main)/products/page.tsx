import ProductsClient from "./ProductsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ProductsPage() {
  return <ProductsClient />;
}
