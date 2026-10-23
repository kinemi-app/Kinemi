/**
 * A deterministic 1200x900 noise image, uploaded through the first file input on the page. Large
 * enough that the app's 512 px downscale is measurable, and the same bytes on every run.
 *
 * Returns the source size, so a test can assert it sits under the 2 MB reference limit.
 */
export async function uploadNoiseImage(browser, sessionId, fileName = "mara.jpg") {
  return browser.evaluate(
    sessionId,
    `(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 900;
      const context = canvas.getContext("2d");
      const image = context.createImageData(canvas.width, canvas.height);
      let seed = 20261020;
      for (let index = 0; index < image.data.length; index += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        image.data[index] = seed & 0xff;
        image.data[index + 1] = (seed >>> 8) & 0xff;
        image.data[index + 2] = (seed >>> 16) & 0xff;
        image.data[index + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      window.__sourceChars = dataUrl.length;
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (char) => char.charCodeAt(0));
      const file = new File([bytes], ${JSON.stringify(fileName)}, { type: "image/jpeg" });
      const input = document.querySelector('input[type="file"]');
      if (!input) throw new Error("no reference file input");
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { sourceChars: dataUrl.length, sourceBytes: bytes.length };
    })()`,
  );
}
