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

function main() {
  const entries = fs.readdirSync(LOAN_DOCUMENTS_DIR, { withFileTypes: true });
  const chunks = [];
  let chunkCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    const dirPath = path.join(LOAN_DOCUMENTS_DIR, dirName);

    const meta = loadJson(path.join(dirPath, "structured", "meta.json"));
    if (!meta) continue;

    const productName = meta.productName || meta.product?.name || meta.sourceSummary?.productName || dirName;
    const ragDir = path.join(dirPath, "rag");

    let ragFiles;
    try {
      ragFiles = fs.readdirSync(ragDir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const mdFile of ragFiles) {
      const topic = path.basename(mdFile, ".md");
      const content = fs.readFileSync(path.join(ragDir, mdFile), "utf-8");
      const sections = splitMarkdownBySections(content);

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        chunkCount++;
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

    console.log(`  ✓ ${dirName}: ${ragFiles.length} md files`);
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
