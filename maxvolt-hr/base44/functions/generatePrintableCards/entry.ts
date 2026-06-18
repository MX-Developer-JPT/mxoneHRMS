import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import QRCode from 'npm:qrcode@1.5.3';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cards } = await req.json();

    if (!cards || !Array.isArray(cards) || cards.length === 0) {
      return Response.json({ error: 'No cards provided' }, { status: 400 });
    }

    // Standard business card dimensions (mm)
    const pageWidth = 210;
    const pageHeight = 297;
    const cardWidth = 90;
    const cardHeight = 50;
    const margin = 10;
    const gapX = 5;
    const gapY = 5;

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'A4'
    });

    let xPosition = margin;
    let yPosition = margin;
    let cardCount = 0;

    for (const card of cards) {
      // Check if we need to move to next row
      if (xPosition + cardWidth > pageWidth - margin) {
        xPosition = margin;
        yPosition += cardHeight + gapY;
      }

      // Check if we need a new page
      if (yPosition + cardHeight > pageHeight - margin) {
        pdf.addPage();
        xPosition = margin;
        yPosition = margin;
      }

      // Generate QR code as image
      const qrDataUrl = await QRCode.toDataURL(card.unique_slug, { 
        width: 200,
        errorCorrectionLevel: 'H',
        type: 'image/png'
      });

      // Draw white background
      pdf.setFillColor(255, 255, 255);
      pdf.rect(xPosition, yPosition, cardWidth, cardHeight, 'F');

      // Draw subtle border
      pdf.setDrawColor(100, 150, 200);
      pdf.setLineWidth(0.3);
      pdf.rect(xPosition, yPosition, cardWidth, cardHeight);

      // Add blue accent bar on left
      pdf.setFillColor(51, 102, 153);
      pdf.rect(xPosition, yPosition, 3, cardHeight, 'F');

      // Left content area
      const contentStartX = xPosition + 5;
      const contentStartY = yPosition + 4;

      // Name - bold and large
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.setTextColor(20, 20, 20);
      pdf.text(card.name, contentStartX, contentStartY);

      // Job title - smaller and colored
      if (card.job_title) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(51, 102, 153);
        pdf.text(card.job_title, contentStartX, contentStartY + 5);
      }

      // Company name
      if (card.company) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(100, 100, 100);
        pdf.text(card.company, contentStartX, contentStartY + 9);
      }

      // Contact details at bottom
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      pdf.setTextColor(80, 80, 80);

      let contactY = yPosition + cardHeight - 10;

      if (card.phone_number) {
        pdf.text(`T: ${card.phone_number}`, contentStartX, contactY);
        contactY += 3;
      }

      if (card.email) {
        pdf.text(`E: ${card.email}`, contentStartX, contactY);
        contactY += 3;
      }

      if (card.website) {
        pdf.text(`W: ${card.website}`, contentStartX, contactY);
      }

      // QR Code on right side
      const qrSize = 16;
      const qrX = xPosition + cardWidth - qrSize - 3;
      const qrY = yPosition + cardHeight - qrSize - 3;
      
      try {
        pdf.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
      } catch (e) {
        console.error('QR code error:', e);
      }

      xPosition += cardWidth + gapX;
      cardCount++;
    }

    const pdfBytes = pdf.output('arraybuffer');
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="visiting-cards.pdf"`
      }
    });
  } catch (error) {
    console.error('Error generating cards:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});