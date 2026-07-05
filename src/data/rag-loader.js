let cachedIndex = null;

const RAG_PRIORITY_TOPICS = ["eligibility", "rates", "limits", "repayment", "fees"];

export async function loadRagIndex() {
  if (cachedIndex) return cachedIndex;
  try {
    const response = await fetch("./src/data/rag/rag-index.json");
    if (!response.ok) return { chunks: [] };
    cachedIndex = await response.json();
    return cachedIndex;
  } catch {
    return { chunks: [] };
  }
}

export function searchRag(query, productId, ragIndex) {
  if (!ragIndex?.chunks?.length) return [];

  const terms = String(query)
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const scored = ragIndex.chunks
    .filter((chunk) => !productId || chunk.productId === productId)
    .map((chunk) => {
      const text = `${chunk.heading} ${chunk.content}`;
      let score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
      score += RAG_PRIORITY_TOPICS.includes(chunk.topic) ? 2 : 0;
      if (chunk.heading?.includes("대출 대상")) score += 3;
      if (chunk.heading?.includes("금리")) score += 3;
      if (chunk.heading?.includes("한도")) score += 3;
      if (chunk.content.includes("대출대상")) score += 2;
      if (chunk.content.includes("대출한도")) score += 2;
      if (chunk.content.includes("대출금리")) score += 2;
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return scored.map(({ chunk }) => ({
    productId: chunk.productId,
    productName: chunk.productName,
    topic: chunk.topic,
    heading: chunk.heading,
    excerpt: makeExcerpt(chunk.content)
  }));
}

function makeExcerpt(content) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? normalized.slice(0, 180) + "..." : normalized;
}
