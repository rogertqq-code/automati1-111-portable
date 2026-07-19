import re

with open("src/intelligence/mouse-humanizer.ts", "r") as f:
    content = f.read()

# Update humanClick delay
# from: await new Promise(r => setTimeout(r, Math.floor(Math.random() * 30)));
# to: await new Promise(r => setTimeout(r, Math.floor(Math.random() * (150 - 60 + 1)) + 60));
content = re.sub(
    r"await new Promise\(r => setTimeout\(r, Math\.floor\(Math\.random\(\) \* 30\)\)\);",
    r"await new Promise(r => setTimeout(r, Math.floor(Math.random() * (150 - 60 + 1)) + 60));",
    content
)

# Replace 40 => 150-60 in ghost-cursor path
content = re.sub(
    r"await new Promise\(r => setTimeout\(r, Math\.floor\(Math\.random\(\) \* 40\) \+ 10\)\);",
    r"await new Promise(r => setTimeout(r, Math.floor(Math.random() * (150 - 60 + 1)) + 60));",
    content
)

# Add bounding box logic to humanClickSelector
old_click_logic = """  // STRICT RULE: native click with ultrafast max 30ms delay
  await page.click(selector, {
    delay: Math.floor(Math.random() * 30),
    force: opts?.force,
    timeout: opts?.timeout,
    clickCount: opts?.clickCount ?? 1,
  });"""

new_click_logic = """  // Calculate 70% inner bounding box
  try {
    const loc = page.locator(selector).first();
    const box = await loc.boundingBox();
    if (box) {
      const xMin = box.x + box.width * 0.15;
      const xMax = box.x + box.width * 0.85;
      const yMin = box.y + box.height * 0.15;
      const yMax = box.y + box.height * 0.85;
      const rx = Math.random() * (xMax - xMin) + xMin;
      const ry = Math.random() * (yMax - yMin) + yMin;
      await humanClickAt(page, rx, ry, opts);
      return;
    }
  } catch { /* fallback to basic click if element is missing */ }

  // STRICT RULE: native click with humanized 60-150ms delay
  await page.click(selector, {
    delay: Math.floor(Math.random() * (150 - 60 + 1)) + 60,
    force: opts?.force,
    timeout: opts?.timeout,
    clickCount: opts?.clickCount ?? 1,
  });"""

content = content.replace(old_click_logic, new_click_logic)

with open("src/intelligence/mouse-humanizer.ts", "w") as f:
    f.write(content)

print("Updated mouse-humanizer.ts")
