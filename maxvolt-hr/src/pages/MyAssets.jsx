import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Laptop, Monitor, Smartphone, Keyboard, Mouse, Headphones, Printer, Router, HardDrive, Usb, Cable, Package, Download, AlertTriangle, Clock, PrinterIcon, PenLine } from 'lucide-react';
import { format, parseISO, isBefore } from 'date-fns';
import { toast } from 'sonner';
import { openLetterheadPrintWindow } from '../utils/letterhead';
import AssetCheckoutDialog from '@/components/assets/AssetCheckoutDialog';

const TYPE_ICONS = {
  laptop: Laptop, monitor: Monitor, smartphone: Smartphone, keyboard: Keyboard,
  mouse: Mouse, headphones: Headphones, printer: Printer, router: Router,
  hard_drive: HardDrive, usb: Usb, cable: Cable, sim: Router,
  desktop: Monitor, tablet: Smartphone, chair: Package, desk: Package, other: Package,
};

const STATUS_COLORS = {
  available: 'bg-green-100 text-green-800',
  assigned: 'bg-blue-100 text-blue-800',
  under_repair: 'bg-yellow-100 text-yellow-800',
  retired: 'bg-gray-100 text-gray-600',
};

export default function MyAssets() {
  const [assets, setAssets] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [checkoutAsset, setCheckoutAsset] = useState(null);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const [assetData, typeData, empData] = await Promise.all([
        base44.entities.Asset.filter({ assigned_to_user_id: currentUser.id, status: 'assigned' }, '-assignment_date', 500),
        base44.entities.AssetType.list(),
        base44.entities.Employee.filter({ user_id: currentUser.id }, '', 1),
      ]);
      setAssets(assetData);
      setAssetTypes(typeData);
      if (empData.length > 0) setEmployee(empData[0]);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const getTypeIcon = (typeId) => {
    const type = assetTypes.find(t => t.id === typeId);
    const iconName = type?.icon || 'other';
    const Icon = TYPE_ICONS[iconName] || Package;
    return Icon;
  };

  const getTypeName = (typeId) => {
    const type = assetTypes.find(t => t.id === typeId);
    return type?.name || 'Unknown';
  };

  const buildAssetLetterContent = (assetList) => {
    const empName = employee?.display_name || user?.display_name || user?.full_name || '—';
    const empCode = employee?.employee_code || '—';
    const empDept = employee?.department || '—';
    const empDesg = employee?.designation || '—';
    const empDOJ = employee?.date_of_joining ? format(parseISO(employee.date_of_joining), 'dd MMMM yyyy') : '—';
    const empDOB = employee?.date_of_birth ? format(parseISO(employee.date_of_birth), 'dd MMMM yyyy') : '—';
    const plural = assetList.length > 1;

    const assetRows = assetList.map(asset => {
      const typeName = asset.asset_type_name || getTypeName(asset.asset_type_id);
      return `
        <tr>
          <td style="padding:5px 10px;border:1px solid #ddd;">${asset.asset_id || '—'}</td>
          <td style="padding:5px 10px;border:1px solid #ddd;">${asset.asset_name}</td>
          <td style="padding:5px 10px;border:1px solid #ddd;">${typeName}</td>
          <td style="padding:5px 10px;border:1px solid #ddd;">${asset.model_number || '—'}</td>
          <td style="padding:5px 10px;border:1px solid #ddd;">${asset.serial_number || '—'}</td>
          <td style="padding:5px 10px;border:1px solid #ddd;">${asset.condition?.toUpperCase()}</td>
          <td style="padding:5px 10px;border:1px solid #ddd;">${asset.is_temporary ? '<span style="color:#e87722;font-weight:600;">⏳ Temporary</span>' : 'Permanent'}</td>
          <td style="padding:5px 10px;border:1px solid #ddd;">${asset.assignment_date ? format(parseISO(asset.assignment_date), 'dd MMM yyyy') : '—'}</td>
          <td style="padding:5px 10px;border:1px solid #ddd;">${asset.return_date ? format(parseISO(asset.return_date), 'dd MMM yyyy') : 'Open-ended'}</td>
        </tr>`;
    }).join('');

    return `
      <div style="margin-bottom:20px;">
        <h2 style="font-size:20px;font-weight:bold;color:#e87722;margin:0 0 2px;">Asset Assignment Letter</h2>
        <div style="font-size:10px;text-align:right;color:#888;margin-bottom:12px;border-bottom:1px solid #f4a83a;padding-bottom:6px;">
          Ref: MAXVOLT/ASSET/${format(new Date(), 'yyyyMMdd')}-${empCode} &nbsp;|&nbsp; Date: ${format(new Date(), 'dd MMMM yyyy')}
        </div>
        <p style="font-size:11px;margin-bottom:12px;line-height:1.5;">
          This letter confirms that the following company-owned asset${plural ? 's have' : ' has'} been issued to the below-named employee. The employee acknowledges receipt and agrees to the terms and conditions outlined herein.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px;">
          <tr>
            <td style="padding:5px 10px;border:1px solid #ddd;background:#f8fafc;width:140px;font-weight:600;">Employee Name</td>
            <td style="padding:5px 10px;border:1px solid #ddd;">${empName}</td>
            <td style="padding:5px 10px;border:1px solid #ddd;background:#f8fafc;width:140px;font-weight:600;">Employee Code</td>
            <td style="padding:5px 10px;border:1px solid #ddd;">${empCode}</td>
          </tr>
          <tr>
            <td style="padding:5px 10px;border:1px solid #ddd;background:#f8fafc;font-weight:600;">Designation</td>
            <td style="padding:5px 10px;border:1px solid #ddd;">${empDesg}</td>
            <td style="padding:5px 10px;border:1px solid #ddd;background:#f8fafc;font-weight:600;">Department</td>
            <td style="padding:5px 10px;border:1px solid #ddd;">${empDept}</td>
          </tr>
          <tr>
            <td style="padding:5px 10px;border:1px solid #ddd;background:#f8fafc;font-weight:600;">Date of Joining</td>
            <td style="padding:5px 10px;border:1px solid #ddd;">${empDOJ}</td>
            <td style="padding:5px 10px;border:1px solid #ddd;background:#f8fafc;font-weight:600;">Date of Birth</td>
            <td style="padding:5px 10px;border:1px solid #ddd;">${empDOB}</td>
          </tr>
        </table>
        <p style="font-size:11px;font-weight:600;margin-bottom:6px;color:#e87722;">Asset${plural ? 's' : ''} Issued:</p>
        <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:14px;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Asset ID</th>
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Name/Model</th>
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Type</th>
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Model No.</th>
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Serial No.</th>
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Condition</th>
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Type</th>
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Issued On</th>
              <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;">Return By</th>
            </tr>
          </thead>
          <tbody>${assetRows}</tbody>
        </table>
        <div style="border:1px solid #ddd;border-radius:4px;padding:12px;margin-bottom:14px;background:#fafafa;">
          <p style="font-size:11px;font-weight:700;margin-bottom:8px;color:#333;">Terms &amp; Conditions</p>
          <ol style="font-size:9px;margin:0;padding-left:16px;line-height:1.6;color:#444;">
            <li>The asset${plural ? 's' : ''} ${plural ? 'are' : 'is'} the sole property of <strong>Maxvolt Energy Industries Limited</strong> and must be returned upon request, resignation, termination, or end of assignment.</li>
            <li>The employee is responsible for the safekeeping and proper use of the asset${plural ? 's' : ''}. Any loss, theft, or damage must be reported to HR/IT immediately.</li>
            <li>Damage beyond normal wear and tear will be assessed, and the cost of repair/replacement may be recovered from the employee's salary or final settlement.</li>
            <li>Unauthorized transfer, sale, or lending of company assets to third parties is strictly prohibited.</li>
            <li>${plural ? 'These assets are' : 'This asset is'} to be used exclusively for official business purposes.</li>
            <li>The employee must allow periodic inspection of the asset${plural ? 's' : ''} by authorized company personnel.</li>
            <li>Software installed on company-provided devices must comply with the company's IT &amp; Software Usage Policy.</li>
            <li>Upon separation, the employee must return all company assets. Non-return may result in deduction from the Full &amp; Final settlement.</li>
          </ol>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:10px;">
          <div style="text-align:center;">
            <div style="border-top:1px solid #333;width:130px;margin-bottom:4px;"></div>
            <p style="font-weight:600;">Employee Signature</p>
            <p style="color:#888;font-size:9px;">(${empName})</p>
          </div>
          <div style="text-align:center;">
            <div style="border-top:1px solid #333;width:130px;margin-bottom:4px;"></div>
            <p style="font-weight:600;">Authorized Signatory</p>
            <p style="color:#888;font-size:9px;">HR / IT Department</p>
          </div>
        </div>
        <div style="margin-top:24px;font-size:9px;text-align:center;color:#888;border-top:1px solid #e5e7eb;padding-top:8px;">
          Maxvolt Energy Industries Limited — Asset Management | This is a computer-generated document and does not require a physical signature.
        </div>
      </div>`;
  };

  const handlePrintLetter = (asset) => {
    openLetterheadPrintWindow(`Asset Letter - ${asset.asset_name}`, buildAssetLetterContent([asset]), '', false);
  };

  const handlePrintAllMyAssets = () => {
    if (assets.length === 0) return;
    openLetterheadPrintWindow(`Asset Letter - All Assets`, buildAssetLetterContent(assets), '', false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Assets</h1>
            <p className="text-muted-foreground text-sm mt-1">Assets assigned to you by the company</p>
          </div>
          {assets.length > 1 && (
            <Button variant="outline" size="sm" onClick={handlePrintAllMyAssets}>
              <PrinterIcon className="w-4 h-4 mr-1" /> Print All ({assets.length})
            </Button>
          )}
        </div>

        {assets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-lg font-medium">No assets assigned</p>
              <p className="text-sm">When company assets are assigned to you, they will appear here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {assets.map(asset => {
              const Icon = getTypeIcon(asset.asset_type_id);
              const isOverdue = asset.return_date && isBefore(parseISO(asset.return_date), new Date());
              return (
                <Card key={asset.id}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="p-3 bg-primary/10 rounded-xl">
                          <Icon className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold text-lg">{asset.asset_name}</h3>
                            <Badge className={STATUS_COLORS[asset.status]}>Assigned</Badge>
                            {asset.is_temporary && <Badge className="bg-orange-100 text-orange-700"><Clock className="w-3 h-3 mr-0.5" />Temporary</Badge>}
                            {isOverdue && <Badge className="bg-red-100 text-red-700"><AlertTriangle className="w-3 h-3 mr-1" />Return Overdue</Badge>}
                          </div>
                          <div className="text-sm text-muted-foreground space-y-1">
                            <p><span className="font-medium text-foreground">Asset ID:</span> <span className="font-mono">{asset.asset_id}</span></p>
                            <p><span className="font-medium text-foreground">Type:</span> {getTypeName(asset.asset_type_id)}</p>
                            {asset.model_number && <p><span className="font-medium text-foreground">Model:</span> {asset.model_number}</p>}
                            {asset.serial_number && <p><span className="font-medium text-foreground">Serial No:</span> {asset.serial_number}</p>}
                            <p><span className="font-medium text-foreground">Condition:</span> <Badge variant="outline" className="text-xs capitalize">{asset.condition}</Badge></p>
                            <p><span className="font-medium text-foreground">Assigned:</span> {asset.assignment_date ? format(parseISO(asset.assignment_date), 'dd MMMM yyyy') : '—'}</p>
                            {asset.return_date && (
                              <p className={isOverdue ? 'text-red-600 font-medium' : ''}>
                                <span className="font-medium text-foreground">Return by:</span> {format(parseISO(asset.return_date), 'dd MMMM yyyy')}
                                {isOverdue && ' (Overdue)'}
                              </p>
                            )}
                            {asset.is_temporary && asset.temporary_reason && <p className="text-xs mt-1 text-orange-600">Reason: {asset.temporary_reason}</p>}
                            {asset.notes && <p className="text-xs mt-1 italic">"{asset.notes}"</p>}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button size="sm" variant="outline" onClick={() => handlePrintLetter(asset)}>
                          <Download className="w-4 h-4 mr-1" /> Letter
                        </Button>
                        <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700" onClick={() => { setCheckoutAsset(asset); setShowCheckout(true); }}>
                          <PenLine className="w-4 h-4 mr-1" /> Sign & Acknowledge
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <AssetCheckoutDialog
        open={showCheckout}
        onOpenChange={setShowCheckout}
        asset={checkoutAsset}
        employee={employee}
        user={user}
        onCheckedOut={() => { setShowCheckout(false); loadData(); }}
      />
    </div>
  );
}