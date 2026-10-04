"""
Genera los PDFs de ejemplo de cada proyecto en public/docs/<slug>/.

Son documentos ficticios, marcados como "EJEMPLO - SIN VALIDEZ LEGAL", que sirven para
probar el visor y la verificación de integridad: el hash SHA-256 del contrato de
fideicomiso queda anclado en el AssetToken al desplegarlo.

La salida es determinística (rl_config.invariant): regenerar no cambia los hashes
mientras no cambie el contenido.

Uso:  python3 scripts/generate-sample-docs.py      (requiere: pip install reportlab)
"""

import json
from pathlib import Path

from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

rl_config.invariant = 1

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = json.loads((ROOT / "data" / "projects.json").read_text(encoding="utf-8"))
OUT = ROOT / "public" / "docs"

INK = colors.HexColor("#13294B")
styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=INK, spaceAfter=4)
SUB = ParagraphStyle("Sub", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, textColor=colors.HexColor("#4A5568"), alignment=1, spaceAfter=10)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=INK, spaceBefore=8, spaceAfter=3)
BODY = ParagraphStyle("Body", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=13.5, alignment=TA_JUSTIFY, spaceAfter=4)

CATEGORY_LABEL = {
    "INMUEBLES": "desarrollo y renta inmobiliaria",
    "AGRO": "producción agropecuaria",
    "DEUDA_PYME": "financiamiento a pequeñas y medianas empresas",
    "EMPRESAS": "participación en el capital de empresas",
}


def usd(n: float) -> str:
    return "USD " + f"{n:,.0f}".replace(",", ".")


def watermark(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 42)
    canvas.setFillColor(colors.Color(0.80, 0.12, 0.12, alpha=0.10))
    canvas.translate(A4[0] / 2, A4[1] / 2)
    canvas.rotate(35)
    canvas.drawCentredString(0, 0, "EJEMPLO - SIN VALIDEZ LEGAL")
    canvas.restoreState()
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#718096"))
    canvas.drawString(18 * mm, 10 * mm, "Documento ficticio generado para la demo de TokenARG. No constituye oferta pública ni asesoramiento.")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Página {doc.page}")
    canvas.restoreState()


def build(path: Path, title: str, subtitle: str, story: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(path), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
        title=title, author="TokenARG (documento de ejemplo)", subject=subtitle,
    )
    doc.build([Paragraph(title, H1), Paragraph(subtitle, SUB), *story], onFirstPage=watermark, onLaterPages=watermark)


def table(rows: list[list[str]]) -> Table:
    t = Table(rows, colWidths=[85 * mm, 85 * mm])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#EEF2F7")]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#C5CEDB")),
        ("ALIGN", (1, 1), (1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def trust_contract(p: dict) -> list:
    soft = usd(p["softCapUSD"])
    hard = usd(p["targetAmountUSD"])
    clauses = [
        ("Partes", f"Entre el fiduciante del proyecto \"{p['title']}\" (el \"Fiduciante\") y {p['trustee']} (el \"Fiduciario\"), "
                   "se celebra el presente contrato de fideicomiso en los términos de los artículos 1666 a 1707 del Código Civil "
                   "y Comercial de la Nación."),
        ("Primera - Objeto", f"El fideicomiso tiene por objeto la {CATEGORY_LABEL[p['category']]} descripta en la ficha del "
                             f"proyecto, ubicada en {p['location']}. {p['summary']}"),
        ("Segunda - Bienes fideicomitidos", "Integran el patrimonio fiduciario los aportes de los inversores, los bienes que se "
                                            "adquieran con ellos y sus frutos. El patrimonio fiduciario está separado del patrimonio "
                                            "del Fiduciario y del Fiduciante."),
        ("Tercera - Beneficiarios", "Son beneficiarios los titulares de los tokens emitidos por el contrato inteligente identificado "
                                    "en el Anexo I, en proporción a su tenencia. El registro de titulares es el que surge de la "
                                    "red Polygon. Solo pueden ser titulares las personas que hayan completado la verificación de "
                                    "identidad y el perfil de inversor exigidos por la normativa de prevención de lavado de activos."),
        ("Cuarta - Representación digital", "Cada token representa una cuotaparte. Las transferencias entre inversores quedan "
                                            "deshabilitadas hasta que el Fiduciario habilite un mecanismo de negociación secundaria. "
                                            "Ante orden judicial o pérdida de credenciales debidamente acreditada, el Fiduciario podrá "
                                            "reasignar la tenencia y las distribuciones pendientes a una nueva billetera verificada."),
        ("Quinta - Colocación", f"El monto de la colocación es de hasta {hard}, a un precio de USD {p['tokenPriceUSD']} por token y con "
                                f"un ticket mínimo de USD {p['minTicketUSD']}. Los aportes se integran en USDC y quedan en garantía "
                                f"en el contrato de colocación. Si al cierre no se alcanza el mínimo de {soft}, cada inversor puede "
                                "retirar la totalidad de su aporte y sus tokens se cancelan."),
        ("Sexta - Distribuciones", "Los fondos netos que genere el patrimonio fiduciario se distribuyen en USDC entre los "
                                   "beneficiarios, a prorrata de los tokens que tengan al momento de cada distribución."),
        ("Séptima - Plazo", f"El fideicomiso tiene un plazo estimado de {p['termMonths']} meses desde el cierre de la colocación, "
                            "prorrogable por decisión de la mayoría de los beneficiarios."),
        ("Octava - Riesgos", "Los beneficiarios declaran conocer, entre otros, los siguientes riesgos: "
                             + "; ".join(r[0].lower() + r[1:] for r in p["risks"]) + ". El rendimiento estimado no está garantizado."),
        ("Novena - Rendición de cuentas", "El Fiduciario rinde cuentas trimestralmente y publica los informes en la ficha del "
                                          "proyecto. Cualquier modificación de este contrato se registra con un nuevo hash "
                                          "en el contrato inteligente."),
        ("Anexo I - Contrato inteligente", f"Red: Polygon PoS. Token: {p['token']['name']} ({p['token']['symbol']}). "
                                           "La dirección del contrato se informa en la ficha del proyecto y en el registro del Fiduciario."),
    ]
    story = []
    for heading, text in clauses:
        story += [Paragraph(heading, H2), Paragraph(text, BODY)]
    return story


def annex(p: dict) -> tuple[str, str, list]:
    t, slug = p["category"], p["slug"]
    if t == "INMUEBLES":
        rows = [["Concepto", "Valor"], ["Valuación del activo", usd(p["assetValuationUSD"])],
                ["Monto a financiar", usd(p["targetAmountUSD"])], ["TIR estimada", f"{p['estimatedIrr']} %"],
                ["Cap rate", f"{p['capRate']} %" if p["capRate"] else "No aplica (desarrollo)"],
                ["Plazo", f"{p['termMonths']} meses"]]
        intro = "Tasación realizada por martillero y corredor público matriculado (ejemplo). Valores en dólares estadounidenses."
        return "tasacion.pdf", "Informe de tasación", [Paragraph(intro, BODY), Spacer(1, 6), table(rows)]
    if t == "AGRO":
        rows = [["Concepto", "Valor"], ["Superficie", "1.200 ha"], ["Cultivos", "Soja 60 % / Maíz 40 %"],
                ["Arrendamientos", usd(54000)], ["Insumos y labores", usd(96000)], ["Seguro multirriesgo", usd(12000)],
                ["Gastos de comercialización", usd(18000)], ["Total a financiar", usd(p["targetAmountUSD"])]]
        intro = "Presupuesto de la campaña elaborado por el ingeniero agrónomo responsable (ejemplo)."
        return "plan-de-siembra.pdf", "Plan de siembra y presupuesto", [Paragraph(intro, BODY), Spacer(1, 6), table(rows)]
    if t == "DEUDA_PYME":
        rows = [["Concepto (último ejercicio)", "Valor"], ["Ventas", usd(2_400_000)], ["EBITDA", usd(310_000)],
                ["Deuda financiera", usd(180_000)], ["Patrimonio neto", usd(890_000)], ["Monto de la serie", usd(p["targetAmountUSD"])]]
        intro = "Resumen de estados contables auditados de la empresa deudora (cifras ficticias convertidas a dólares)."
        return "estados-contables.pdf", "Estados contables del deudor", [Paragraph(intro, BODY), Spacer(1, 6), table(rows)]
    rows = [["Año", "Botellas proyectadas"], ["2027", "220.000"], ["2028", "290.000"], ["2029", "350.000"],
            ["2030", "390.000"], ["2031", "400.000"]]
    intro = "Proyección de volumen de la bodega luego de la ampliación (ejemplo)."
    return "plan-de-negocios.pdf", "Plan de negocios 2027-2031", [Paragraph(intro, BODY), Spacer(1, 6), table(rows)]


def main() -> None:
    for p in PROJECTS:
        folder = OUT / p["slug"]
        build(folder / "contrato-fideicomiso.pdf", f"Contrato de fideicomiso - {p['issuer']}",
              f"Fiduciario: {p['trustee']}", trust_contract(p))
        filename, title, story = annex(p)
        build(folder / filename, f"{title} - {p['title']}", p["issuer"], story)
        expected = {d["file"] for d in p["documents"]}
        generated = {f"{p['slug']}/contrato-fideicomiso.pdf", f"{p['slug']}/{filename}"}
        assert expected == generated, f"{p['slug']}: projects.json espera {expected}, se generó {generated}"
        print(f"ok  {p['slug']}")


if __name__ == "__main__":
    main()
