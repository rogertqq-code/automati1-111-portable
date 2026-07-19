/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { Page } from "playwright-core";
import "dotenv/config";

export async function healSelector(page: Page, targetDescription: string): Promise<string | null> {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    console.warn("[Hermes Healer] OPENROUTER_API_KEY not set. Cannot heal selector.");
    return null;
  }

  try {
    console.log(`[Hermes Healer] Attempting to heal selector for: "${targetDescription}"`);
    
    const cdp = await page.context().newCDPSession(page);
    const evaluateResult = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          function cleanNode(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return null;
            const tag = node.tagName.toLowerCase();
            if (['script', 'style', 'svg', 'path', 'noscript', 'meta', 'link'].includes(tag)) return null;
            
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;
            
            const obj = { 
                tag,
                x: Math.round(rect.x + window.scrollX),
                y: Math.round(rect.y + window.scrollY)
            };
            
            const id = node.getAttribute("id");
            if (id) obj.id = id;
            
            const name = node.getAttribute("name");
            if (name) obj.name = name;
            
            const type = node.getAttribute("type");
            if (type) obj.type = type;
            
            const placeholder = node.getAttribute("placeholder");
            if (placeholder) obj.placeholder = placeholder;
            
            const ariaLabel = node.getAttribute("aria-label");
            if (ariaLabel) obj.ariaLabel = ariaLabel;
            
            if (['button', 'a', 'label', 'span', 'div', 'iframe'].includes(tag)) {
                const text = node.textContent?.trim();
                if (text && text.length < 50) obj.text = text;
            }

            const childrenNodes = node.shadowRoot ? Array.from(node.shadowRoot.children) : Array.from(node.children);
            const children = childrenNodes
              .map(cleanNode)
              .filter(Boolean);
              
            if (children.length > 0) obj.children = children;
            
            return Object.keys(obj).length > 3 ? obj : null;
          }
          return JSON.stringify(cleanNode(document.body));
        })();
      `,
      returnByValue: true
    });
    await cdp.detach();

    const compactedDOM = JSON.parse(evaluateResult.result.value);
    const domString = JSON.stringify(compactedDOM).slice(0, 15000); // Prevent massive payloads

    const promptText = `
You are an expert web automation AI. A hardcoded Playwright script failed to find the element for: "${targetDescription}".
The UI may have changed. Below is a compacted JSON representation of the currently visible DOM including [x,y] absolute coordinates.

Find the most robust CSS selector for the "${targetDescription}".
Output ONLY the raw CSS selector string. Do not use markdown, do not use backticks, do not add explanations.
If the element exists but is heavily obfuscated without viable CSS attributes, output the coordinates in the exact format "COORD:x,y" (e.g. COORD:450,600).
If you absolutely cannot find it anywhere in the DOM, output "NULL".

DOM Snapshot:
${domString}
    `;

    const url = "https://openrouter.ai/api/v1/chat/completions";
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-coder",
        messages: [{ role: "user", content: promptText }]
      }),
      signal: AbortSignal.timeout(15000)
    });

    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const aiResponse = json.choices?.[0]?.message?.content?.trim();

    if (aiResponse && aiResponse !== "NULL" && aiResponse !== "null") {
      console.log(`[Hermes Healer] Successfully healed selector. New selector: ${aiResponse}`);
      return aiResponse;
    }
    
    console.warn(`[Hermes Healer] AI could not determine a new selector.`);
    return null;
  } catch (e: unknown) {
    console.warn(`[Hermes Healer] Healing failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
