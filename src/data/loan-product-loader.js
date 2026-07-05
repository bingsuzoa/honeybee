let cachedProducts = null;

export async function loadProducts() {
  if (cachedProducts) return cachedProducts;
  const response = await fetch("./src/data/products.json");
  if (!response.ok) throw new Error(`Failed to load products: ${response.status}`);
  const data = await response.json();
  cachedProducts = data.products;
  return cachedProducts;
}
