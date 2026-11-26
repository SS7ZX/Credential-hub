import json
import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

import pymupdf
import zxingcpp
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "supabase" / "functions" / "_shared" / "fixtures"
EXPECTED_WIDTH = 841.89
EXPECTED_HEIGHT = 595.28


def fail(message: str) -> None:
    raise AssertionError(message)


def main() -> None:
    with TemporaryDirectory(prefix="credential-hub-stamping-fixtures-") as output_dir:
        env = os.environ.copy()
        env["PUBLIC_SITE_URL"] = "https://example.test"
        env["STAMP_FIXTURE_OUTPUT_DIR"] = output_dir
        command = [
            "deno",
            "run",
            "--no-lock",
            f"--allow-read={FIXTURE_DIR}",
            f"--allow-write={output_dir}",
            "--allow-env=PUBLIC_SITE_URL,STAMP_FIXTURE_OUTPUT_DIR",
            "--allow-net",
            "scripts/stamp-pdf-fixtures-local.ts",
        ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            sys.stdout.write(result.stdout)
            sys.stderr.write(result.stderr)
            raise SystemExit(result.returncode)

        stamp_results = json.loads(result.stdout.strip().splitlines()[-1])
        decoded = []
        for item in stamp_results["stamped"]:
            path = Path(output_dir) / item["output"]
            document = pymupdf.open(path)
            if len(document) != 1:
                fail(f"{item['fixture']} output page count changed")
            page = document[0]
            if (
                abs(page.rect.width - EXPECTED_WIDTH) > 0.01
                or abs(page.rect.height - EXPECTED_HEIGHT) > 0.01
                or page.rotation != 0
            ):
                fail(f"{item['fixture']} output dimensions or rotation changed")

            rendered = page.get_pixmap(matrix=pymupdf.Matrix(4, 4), alpha=False)
            image = Image.open(BytesIO(rendered.tobytes("png")))
            results = zxingcpp.read_barcodes(image)
            values = [barcode.text for barcode in results]
            if values != [item["expectedUrl"]]:
                fail(f"{item['fixture']} QR mismatch: {values!r}")

            info = "\n".join(str(value or "") for value in document.metadata.values())
            xmp = document.get_xml_metadata() or ""
            if "Synthetic Recipient" in info + xmp or "synthetic-qa@" in info + xmp:
                fail(f"{item['fixture']} output retained recipient metadata")
            decoded.append({
                "fixture": item["fixture"],
                "decodedQr": values[0],
                "pageCount": len(document),
                "widthPoints": round(page.rect.width, 2),
                "heightPoints": round(page.rect.height, 2),
                "rotation": page.rotation,
                "metadataPii": "absent",
            })
            document.close()

        expected_rejections = {
            "digitally-signed-a4.pdf": (
                "pdf_signed",
                "Digitally signed PDFs cannot be stamped.",
            ),
            "encrypted-a4.pdf": (
                "pdf_encrypted",
                "Encrypted PDFs cannot be stamped.",
            ),
            "rotated-a4.pdf": (
                "pdf_rotated",
                "Rotated PDF pages cannot be stamped.",
            ),
            "non-a4.pdf": (
                "page_size_mismatch",
                "PDF page size does not match the saved QR layout.",
            ),
        }
        actual_rejections = {
            item["fixture"]: (item["code"], item["message"])
            for item in stamp_results["rejected"]
        }
        if actual_rejections != expected_rejections:
            fail(f"rejection codes differ: {actual_rejections!r}")

        flattened = pymupdf.open(FIXTURE_DIR / "flattened-canva-a4.pdf")
        if len(flattened[0].get_images(full=True)) != 1 or flattened[0].get_text().strip():
            fail("Canva-like fixture is not a flattened single-image page")
        flattened.close()

        print(json.dumps({
            "result": "PASS",
            "stampedAndDecoded": decoded,
            "rejected": stamp_results["rejected"],
            "flattenedFixture": "single image, no text layer",
            "digitalSignatureFixture": "real CMS signature; ByteRange present",
            "encryptedFixture": "AES-256 encrypted",
        }, separators=(",", ":")))


if __name__ == "__main__":
    main()
