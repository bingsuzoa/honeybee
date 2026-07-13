import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOAN_DOCUMENTS_DIR = path.resolve(__dirname, "../loan-documents");
const OUTPUT_PATH = path.resolve(__dirname, "../src/data/rag/rag-index.json");

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function splitMarkdownBySections(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  let currentHeading = "";
  let currentContent = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
      }
      currentHeading = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
  }

  return sections.filter((s) => s.content.length > 0);
}

function processProductDir(dirPath, dirName, chunks) {
  // Try meta.json first (KB/shinhan format)
  let meta = loadJson(path.join(dirPath, "structured", "meta.json"));
  // Try product.json (woori/hana/NH format)
  if (!meta) {
    const product = loadJson(path.join(dirPath, "structured", "product.json"));
    if (product) {
      meta = { productName: product.productName };
    }
  }
  if (!meta) return 0;

  const productName = meta.productName || meta.product?.name || meta.sourceSummary?.productName || dirName;
  const ragDir = path.join(dirPath, "rag");

  let ragFiles;
  try {
    ragFiles = fs.readdirSync(ragDir).filter((f) => f.endsWith(".md"));
  } catch {
    return 0;
  }

  let count = 0;
  for (const mdFile of ragFiles) {
    const topic = path.basename(mdFile, ".md");
    const content = fs.readFileSync(path.join(ragDir, mdFile), "utf-8");
    const sections = splitMarkdownBySections(content);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      count++;
      chunks.push({
        id: `${dirName}/${topic}/section-${i + 1}`,
        productId: dirName,
        productName,
        topic,
        heading: section.heading,
        content: section.content
      });
    }
  }

  if (count > 0) console.log(`  ✓ ${dirName}: ${ragFiles.length} md files`);
  return count;
}

function main() {
  const entries = fs.readdirSync(LOAN_DOCUMENTS_DIR, { withFileTypes: true });
  const chunks = [];
  let chunkCount = 0;

  // 정책대출
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "general" || entry.name === "regulations") continue;
    const dirPath = path.join(LOAN_DOCUMENTS_DIR, entry.name);
    chunkCount += processProductDir(dirPath, entry.name, chunks);
  }

  // 일반 주담대 (general/ 하위 재귀 탐색)
  const generalDir = path.join(LOAN_DOCUMENTS_DIR, "general");
  if (fs.existsSync(generalDir)) {
    const bankGroups = fs.readdirSync(generalDir, { withFileTypes: true });
    for (const bankEntry of bankGroups) {
      if (!bankEntry.isDirectory()) continue;
      const bankPath = path.join(generalDir, bankEntry.name);

      // Direct product dir?
      if (fs.existsSync(path.join(bankPath, "structured", "meta.json")) ||
          fs.existsSync(path.join(bankPath, "structured", "product.json"))) {
        chunkCount += processProductDir(bankPath, bankEntry.name, chunks);
        continue;
      }

      // Bank group: iterate sub-products
      const subEntries = fs.readdirSync(bankPath, { withFileTypes: true });
      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory() || subEntry.name === "common") continue;
        const subPath = path.join(bankPath, subEntry.name);
        const subId = `${bankEntry.name}/${subEntry.name}`;
        chunkCount += processProductDir(subPath, subId, chunks);
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    chunks
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nGenerated ${chunkCount} chunks → ${OUTPUT_PATH}`);
}

main();
