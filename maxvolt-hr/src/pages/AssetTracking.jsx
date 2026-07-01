import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Edit2, Trash2, Laptop, Monitor, Smartphone, Keyboard, Mouse, Headphones, Printer, Router, HardDrive, Usb, Cable, Search, CheckCircle2, AlertTriangle, Download, Package, Boxes, Tags, ArrowLeft, UserCheck, UserX, RotateCcw, Clock, FileText, PrinterIcon, Wrench, IndianRupee, Upload, FileSpreadsheet, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from 'sonner';
import { format, isAfter, isBefore, addDays, parseISO } from 'date-fns';
import { openLetterheadPrintWindow } from '../utils/letterhead';
import AssetActivityLog from '@/components/assets/AssetActivityLog';

const TYPE_ICONS = {
  laptop: Laptop, monitor: Monitor, smartphone: Smartphone, keyboard: Keyboard,
  mouse: Mouse, headphones: Headphones, printer: Printer, router: Router,
  hard_drive: HardDrive, usb: Usb, cable: Cable, sim: Router,
  desktop: Monitor, tablet: Smartphone, chair: Package, desk: Package, other: Package,
};

const STATUS_COLORS = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  assigned: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  under_repair: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  discarded: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

const CONDITION_COLORS = {
  new: 'bg-emerald-100 text-emerald-700', good: 'bg-green-100 text-green-700',
  fair: 'bg-yellow-100 text-yellow-700', poor: 'bg-orange-100 text-orange-700',
  damaged: 'bg-red-100 text-red-700',
};

function getTypeIcon(iconName) {
  const Icon = TYPE_ICONS[iconName] || Package;
  return Icon;
}

export default function AssetTracking() {
  const [assets, setAssets] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedTypeId, setSelectedTypeId] = useState(null);
  const [activeTab, setActiveTab] = useState('inventory');
  const [showAssetDialog, setShowAssetDialog] = useState(false);
  const [showTypeDialog, setShowTypeDialog] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [returningAsset, setReturningAsset] = useState(null);
  const [returnForm, setReturnForm] = useState({ returned_condition: 'good', returned_date: format(new Date(), 'yyyy-MM-dd'), notes: '' });
  const [showMaintenanceDialog, setShowMaintenanceDialog] = useState(false);
  const [editingMaintenance, setEditingMaintenance] = useState(null);
  const [maintenanceLogs, setMaintenanceLogs] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [selectedAssetForMaintenance, setSelectedAssetForMaintenance] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState({
    asset_id: '', maintenance_type: 'repair', service_date: format(new Date(), 'yyyy-MM-dd'),
    completion_date: '', cost: '', vendor_name: '', description: '',
    status: 'pending', technician_notes: '', parts_replaced: '', warranty_covered: false,
  });
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkEmployeeId, setBulkEmployeeId] = useState('');
  const [bulkEmpOpen, setBulkEmpOpen] = useState(false);
  const [assetAssignOpen, setAssetAssignOpen] = useState({});
  const [assetDialogEmpOpen, setAssetDialogEmpOpen] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [assetForm, setAssetForm] = useState({
    asset_name: '', asset_type_id: '', serial_number: '', model_number: '',
    assigned_to_user_id: '', assignment_date: '', return_date: '',
    condition: 'good', purchase_date: '', purchase_cost: '',
    warranty_expiry: '', status: 'available', notes: '',
  });
  const [typeForm, setTypeForm] = useState({ name: '', code: '', icon: 'other', description: '' });
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [assetData, typeData, empData, logsData, activityData] = await Promise.all([
        base44.entities.Asset.list('-created_date', 1000),
        base44.entities.AssetType.filter({ is_active: true }, 'name'),
        base44.entities.Employee.list(),
        base44.entities.MaintenanceLog.list('-created_date', 500),
        base44.entities.AssetActivityLog.list('-created_date', 200),
      ]);
      setAssets(assetData);
      setAssetTypes(typeData);
      setEmployees(empData);
      setMaintenanceLogs(logsData);
      setActivityLogs(activityData);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const getEmployeeName = (userId) => {
    if (!userId) return '—';
    if (userId === '__common__') return '📦 Common Asset';
    return employees.find(e => e.user_id === userId)?.display_name || userId;
  };

  const getEmployee = (userId) => {
    if (userId === '__common__') return { display_name: 'Common Asset', employee_code: 'SHARED', department: 'All', designation: 'Shared Asset' };
    return employees.find(e => e.user_id === userId);
  };

  const getTypeName = (typeId) => {
    if (!typeId) return 'Unmapped';
    const t = assetTypes.find(at => at.id === typeId);
    return t?.name || 'Unknown';
  };

  // Group assets by type
  const groupedAssets = useMemo(() => {
    const groups = {};
    assetTypes.forEach(type => {
      const typeAssets = assets.filter(a => a.asset_type_id === type.id);
      groups[type.id] = {
        type,
        total: typeAssets.length,
        available: typeAssets.filter(a => a.status === 'available').length,
        assigned: typeAssets.filter(a => a.status === 'assigned').length,
        underRepair: typeAssets.filter(a => a.status === 'under_repair').length,
        assets: typeAssets,
      };
    });
    // Handle legacy assets without asset_type_id
    const legacyAssets = assets.filter(a => !a.asset_type_id);
    if (legacyAssets.length > 0) {
      groups['_legacy'] = {
        type: { id: '_legacy', name: 'Legacy / Unmapped', code: 'LEG', icon: 'other' },
        total: legacyAssets.length,
        available: legacyAssets.filter(a => a.status === 'available').length,
        assigned: legacyAssets.filter(a => a.status === 'assigned').length,
        underRepair: legacyAssets.filter(a => a.status === 'under_repair').length,
        assets: legacyAssets,
      };
    }
    return groups;
  }, [assets, assetTypes]);

  // Flat filtered list
  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      const s = search.toLowerCase();
      const matchSearch = !s || a.asset_name?.toLowerCase().includes(s) ||
        a.asset_id?.toLowerCase().includes(s) || a.serial_number?.toLowerCase().includes(s) ||
        a.model_number?.toLowerCase().includes(s) ||
        getEmployeeName(a.assigned_to_user_id).toLowerCase().includes(s);
      const matchStatus = filterStatus === 'all' || a.status === filterStatus;
      const matchType = !selectedTypeId || a.asset_type_id === selectedTypeId;
      return matchSearch && matchStatus && matchType;
    });
  }, [assets, search, filterStatus, selectedTypeId]);

  const stats = useMemo(() => ({
    total: assets.length,
    assigned: assets.filter(a => a.status === 'assigned').length,
    available: assets.filter(a => a.status === 'available').length,
    underRepair: assets.filter(a => a.status === 'under_repair').length,
    overdueReturns: assets.filter(a => a.status === 'assigned' && a.return_date && isBefore(parseISO(a.return_date), new Date())).length,
  }), [assets]);

  // --- Asset Type Management ---
  const openNewType = () => {
    setEditingType(null);
    setTypeForm({ name: '', code: '', icon: 'other', description: '' });
    setShowTypeDialog(true);
  };

  const openEditType = (type) => {
    setEditingType(type);
    setTypeForm({ name: type.name, code: type.code, icon: type.icon || 'other', description: type.description || '' });
    setShowTypeDialog(true);
  };

  const handleSaveType = async () => {
    if (!typeForm.name.trim() || !typeForm.code.trim()) { toast.error('Name and code are required'); return; }
    setSaving(true);
    try {
      if (editingType) {
        await base44.entities.AssetType.update(editingType.id, typeForm);
        toast.success('Asset type updated');
      } else {
        await base44.entities.AssetType.create(typeForm);
        toast.success('Asset type created');
      }
      setShowTypeDialog(false);
      loadData();
    } catch (err) { toast.error('Error saving asset type'); }
    setSaving(false);
  };

  const handleDeleteType = async (type) => {
    const count = assets.filter(a => a.asset_type_id === type.id).length;
    if (count > 0) {
      toast.error(`Cannot delete "${type.name}" — ${count} asset(s) still exist under this type`);
      return;
    }
    if (!confirm(`Delete asset type "${type.name}"?`)) return;
    await base44.entities.AssetType.delete(type.id);
    toast.success('Asset type deleted');
    loadData();
  };

  // --- Asset Management ---
  const generateAssetId = (typeId) => {
    const type = assetTypes.find(t => t.id === typeId);
    const prefix = type?.code || 'AST';
    const existing = assets.filter(a => a.asset_type_id === typeId && a.asset_id?.startsWith(prefix));
    const maxNum = existing.reduce((max, a) => {
      const num = parseInt(a.asset_id?.replace(prefix + '-', '')) || 0;
      return Math.max(max, num);
    }, 0);
    return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
  };

  const openNewAsset = (typeId) => {
    setEditingAsset(null);
    const type = assetTypes.find(t => t.id === typeId);
    const autoId = typeId ? generateAssetId(typeId) : '';
    setAssetForm({
      asset_name: '', asset_type_id: typeId || '', serial_number: '', model_number: '',
      assigned_to_user_id: '', assignment_date: '', return_date: '',
      condition: 'good', purchase_date: '', purchase_cost: '',
      warranty_expiry: '', status: 'available', notes: '',
      is_temporary: false, temporary_reason: '',
    });
    setSelectedTypeId(typeId || null);
    setShowAssetDialog(true);
  };

  const openEditAsset = (asset) => {
    setEditingAsset(asset);
    setAssetForm({
      asset_name: asset.asset_name || '', asset_type_id: asset.asset_type_id || '',
      serial_number: asset.serial_number || '', model_number: asset.model_number || '',
      assigned_to_user_id: asset.assigned_to_user_id || '', assignment_date: asset.assignment_date || '',
      return_date: asset.return_date || '', condition: asset.condition || 'good',
      purchase_date: asset.purchase_date || '', purchase_cost: asset.purchase_cost || '',
      warranty_expiry: asset.warranty_expiry || '', status: asset.status || 'available', notes: asset.notes || '',
      is_temporary: asset.is_temporary || false, temporary_reason: asset.temporary_reason || '',
    });
    setShowAssetDialog(true);
  };

  const handleAssetFormTypeChange = (typeId) => {
    const newForm = { ...assetForm, asset_type_id: typeId };
    // Auto-generate ID when type changes on new asset
    if (!editingAsset && typeId) {
      newForm.asset_id = generateAssetId(typeId);
    }
    setAssetForm(newForm);
  };

  const handleSaveAsset = async () => {
    if (!assetForm.asset_name.trim()) { toast.error('Asset name is required'); return; }
    if (!assetForm.asset_type_id) { toast.error('Asset type is required'); return; }
    setSaving(true);
    try {
      const type = assetTypes.find(t => t.id === assetForm.asset_type_id);
      const data = {
        ...assetForm,
        purchase_cost: parseFloat(assetForm.purchase_cost) || 0,
        asset_type_name: type?.name || '',
      };
      if (!editingAsset && !data.asset_id) {
        data.asset_id = generateAssetId(data.asset_type_id);
      }
      if (data.assigned_to_user_id) data.status = 'assigned';
      else if (!editingAsset || assetForm.status === 'available') data.status = 'available';

      if (editingAsset) {
        await base44.entities.Asset.update(editingAsset.id, data);
        toast.success('Asset updated');
      } else {
        await base44.entities.Asset.create(data);
        toast.success('Asset added');
      }
      setShowAssetDialog(false);
      loadData();
    } catch (err) { toast.error('Error saving asset'); }
    setSaving(false);
  };

  const handleDeleteAsset = async (id, name) => {
    if (!confirm(`Delete asset "${name}"?`)) return;
    await base44.entities.Asset.delete(id);
    toast.success('Asset deleted');
    loadData();
  };

  const handleAssignEmployee = async (asset, userId) => {
    const isCommon = userId === '__common__';
    const name = isCommon ? 'Common Asset Pool' : (employees.find(e => e.user_id === userId)?.display_name || 'employee');
    if (!confirm(`Assign ${asset.asset_name} to ${name}?`)) return;
    try {
      await base44.entities.Asset.update(asset.id, {
        assigned_to_user_id: userId,
        status: 'assigned',
        assignment_date: format(new Date(), 'yyyy-MM-dd'),
      });
      toast.success(`Asset assigned to ${name}`);
      loadData();
    } catch (err) { toast.error('Error assigning asset'); }
  };

  const openReturnDialog = (asset) => {
    setReturningAsset(asset);
    setReturnForm({ returned_condition: 'good', returned_date: format(new Date(), 'yyyy-MM-dd'), notes: '' });
    setShowReturnDialog(true);
  };

  const handleConfirmReturn = async () => {
    if (!returningAsset) return;
    setSaving(true);
    try {
      await base44.entities.Asset.update(returningAsset.id, {
        assigned_to_user_id: '',
        status: 'available',
        returned_condition: returnForm.returned_condition,
        returned_date: returnForm.returned_date,
        assignment_date: '',
        return_date: '',
        is_temporary: false,
        temporary_reason: '',
        notes: returningAsset.notes ? `${returningAsset.notes}\nReturned: ${returnForm.notes}` : `Returned: ${returnForm.notes}`,
      });
      toast.success(`${returningAsset.asset_name} returned successfully`);
      setShowReturnDialog(false);
      loadData();
    } catch (err) { toast.error('Error returning asset'); }
    setSaving(false);
  };

  const handleUnassignAsset = async (asset) => {
    if (!confirm(`Unassign ${asset.asset_name}?`)) return;
    try {
      await base44.entities.Asset.update(asset.id, {
        assigned_to_user_id: '',
        status: 'available',
        assignment_date: '',
        return_date: '',
      });
      toast.success('Asset unassigned');
      loadData();
    } catch (err) { toast.error('Error unassigning asset'); }
  };

  // --- Bulk Selection ---
  const toggleBulkSelect = (assetId) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
      return next;
    });
  };

  const selectAllFiltered = () => {
    const selectable = filteredAssets.filter(a => a.status === 'available');
    if (selectable.length === 0) return;
    const allSelected = selectable.every(a => bulkSelected.has(a.id));
    setBulkSelected(new Set(allSelected ? [] : selectable.map(a => a.id)));
  };

  const clearBulkSelection = () => { setBulkSelected(new Set()); setBulkEmployeeId(''); };

  const handleBulkAssign = async () => {
    if (bulkSelected.size === 0 || !bulkEmployeeId) return;
    const emp = getEmployee(bulkEmployeeId);
    if (!emp) { toast.error('Employee not found'); return; }
    const selectedAssets = assets.filter(a => bulkSelected.has(a.id) && a.status === 'available');
    if (selectedAssets.length === 0) { toast.error('No available assets selected'); return; }
    setBulkAssigning(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      await Promise.all(selectedAssets.map(a =>
        base44.entities.Asset.update(a.id, { assigned_to_user_id: bulkEmployeeId, status: 'assigned', assignment_date: today })
      ));
      toast.success(`${selectedAssets.length} asset(s) assigned to ${emp.display_name}`);
      // Print combined letterhead
      const updatedAssets = selectedAssets.map(a => ({ ...a, assigned_to_user_id: bulkEmployeeId, status: 'assigned', assignment_date: today }));
      openLetterheadPrintWindow(`Asset Letter - ${emp.display_name}`, buildAssetLetterContent(emp, updatedAssets), '', false);
      clearBulkSelection();
      loadData();
    } catch (err) { toast.error('Error assigning assets'); }
    setBulkAssigning(false);
  };

  const buildAssetLetterContent = (emp, assetList) => {
    const empName = emp?.display_name || '—';
    const empCode = emp?.employee_code || '—';
    const empDept = emp?.department || '—';
    const empDesg = emp?.designation || '—';
    const empDOJ = emp?.date_of_joining ? format(parseISO(emp.date_of_joining), 'dd MMMM yyyy') : '—';
    const empDOB = emp?.date_of_birth ? format(parseISO(emp.date_of_birth), 'dd MMMM yyyy') : '—';
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

    const tempAssets = assetList.filter(a => a.is_temporary);
    const tempNote = tempAssets.length > 0 ? `
      <p style="font-size:10px;color:#e87722;margin-top:12px;padding:8px;background:#fff8f0;border:1px solid #f4a83a;border-radius:4px;">
        ⚠️ Temporary Asset(s): ${tempAssets.map(a => `${a.asset_name} (${a.asset_id}) - ${a.temporary_reason || 'Temporary replacement'}`).join('; ')}.
        These assets must be returned once the original device is restored or the specified period ends.
      </p>` : '';

    return `
      <div style="margin-bottom:20px;">
        <h2 style="font-size:20px;font-weight:bold;color:#e87722;margin:0 0 2px;">Asset ${plural ? 'Assignment' : 'Assignment'} Letter</h2>
        <div style="font-size:10px;text-align:right;color:#888;margin-bottom:12px;border-bottom:1px solid #f4a83a;padding-bottom:6px;">
          Ref: MAXVOLT/ASSET/${format(new Date(), 'yyyyMMdd')}-${empCode} &nbsp;|&nbsp; Date: ${format(new Date(), 'dd MMMM yyyy')}
        </div>

        <p style="font-size:11px;margin-bottom:12px;line-height:1.5;">
          This letter confirms that the following company-owned asset${plural ? 's have' : ' has'} been issued to the below-named employee. The employee acknowledges receipt and agrees to the terms and conditions outlined herein.
        </p>

        <!-- Employee Details -->
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

        <!-- Asset Details -->
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
        ${tempNote}

        <!-- Terms & Conditions -->
        <div style="border:1px solid #ddd;border-radius:4px;padding:12px;margin-bottom:14px;background:#fafafa;">
          <p style="font-size:11px;font-weight:700;margin-bottom:8px;color:#333;">Terms &amp; Conditions</p>
          <ol style="font-size:9px;margin:0;padding-left:16px;line-height:1.6;color:#444;">
            <li>The asset${plural ? 's' : ''} ${plural ? 'are' : 'is'} the sole property of <strong>Maxvolt Energy Industries Limited</strong> and must be returned upon request, resignation, termination, or end of assignment.</li>
            <li>The employee is responsible for the safekeeping and proper use of the asset${plural ? 's' : ''}. Any loss, theft, or damage must be reported to HR/IT immediately.</li>
            <li>Damage beyond normal wear and tear will be assessed, and the cost of repair/replacement may be recovered from the employee's salary or final settlement as per company policy.</li>
            <li>Unauthorized transfer, sale, or lending of company assets to third parties is strictly prohibited.</li>
            <li>${plural ? 'These assets are' : 'This asset is'} to be used exclusively for official business purposes of the company.</li>
            <li>The employee must allow periodic inspection of the asset${plural ? 's' : ''} by authorized company personnel.</li>
            <li>Software installed on company-provided devices must comply with the company's IT &amp; Software Usage Policy.</li>
            <li>Temporary assets must be returned on or before the specified return date or once the original asset is restored from repair.</li>
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

  // --- Maintenance Log Management ---
  const openMaintenanceDialog = (asset) => {
    setSelectedAssetForMaintenance(asset);
    setEditingMaintenance(null);
    setMaintenanceForm({
      asset_id: asset.id, maintenance_type: 'repair', service_date: format(new Date(), 'yyyy-MM-dd'),
      completion_date: '', cost: '', vendor_name: '', description: '',
      status: 'pending', technician_notes: '', parts_replaced: '', warranty_covered: false,
    });
    setShowMaintenanceDialog(true);
  };

  const openEditMaintenance = (log) => {
    setEditingMaintenance(log);
    setSelectedAssetForMaintenance(assets.find(a => a.id === log.asset_id));
    setMaintenanceForm({
      asset_id: log.asset_id, maintenance_type: log.maintenance_type || 'repair',
      service_date: log.service_date || '', completion_date: log.completion_date || '',
      cost: log.cost || '', vendor_name: log.vendor_name || '',
      description: log.description || '', status: log.status || 'pending',
      technician_notes: log.technician_notes || '', parts_replaced: log.parts_replaced || '',
      warranty_covered: log.warranty_covered || false,
    });
    setShowMaintenanceDialog(true);
  };

  const handleSaveMaintenance = async () => {
    if (!maintenanceForm.asset_id || !maintenanceForm.maintenance_type || !maintenanceForm.service_date) {
      toast.error('Asset, type and service date are required'); return;
    }
    setSaving(true);
    try {
      const data = { ...maintenanceForm, cost: parseFloat(maintenanceForm.cost) || 0 };
      if (editingMaintenance) {
        await base44.entities.MaintenanceLog.update(editingMaintenance.id, data);
        toast.success('Maintenance log updated');
      } else {
        await base44.entities.MaintenanceLog.create(data);
        toast.success('Maintenance log added');
      }
      // If marking as in_progress/completed, update asset status
      if (data.status === 'in_progress' && selectedAssetForMaintenance?.status !== 'under_repair') {
        await base44.entities.Asset.update(data.asset_id, { status: 'under_repair' });
      }
      if (data.status === 'completed' && selectedAssetForMaintenance?.status === 'under_repair') {
        await base44.entities.Asset.update(data.asset_id, { status: 'available', condition: 'good' });
      }
      setShowMaintenanceDialog(false);
      loadData();
    } catch (err) { toast.error('Error saving maintenance log'); }
    setSaving(false);
  };

  const handleDeleteMaintenance = async (logId) => {
    if (!confirm('Delete this maintenance log?')) return;
    await base44.entities.MaintenanceLog.delete(logId);
    toast.success('Maintenance log deleted');
    loadData();
  };

  const getMaintenanceLogsForAsset = (assetId) => {
    return maintenanceLogs.filter(l => l.asset_id === assetId).sort((a, b) =>
      (b.service_date || '').localeCompare(a.service_date || '')
    );
  };

  const maintenanceTypeColors = {
    repair: 'bg-red-100 text-red-800', service: 'bg-blue-100 text-blue-800',
    upgrade: 'bg-purple-100 text-purple-800', inspection: 'bg-green-100 text-green-800',
    replacement: 'bg-orange-100 text-orange-800', other: 'bg-gray-100 text-gray-800',
  };
  const maintenanceStatusColors = {
    pending: 'bg-yellow-100 text-yellow-800', in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800', cancelled: 'bg-gray-100 text-gray-800',
  };

  const handlePrintLetter = (asset) => {
    const emp = getEmployee(asset.assigned_to_user_id);
    if (!emp) { toast.error('Employee record not found'); return; }
    openLetterheadPrintWindow(`Asset Letter - ${asset.asset_name}`, buildAssetLetterContent(emp, [asset]), '', false);
  };

  // --- Bulk Import ---
  const handleImportFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) setImportFile(f);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResults(null);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: importFile });
      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: 'object',
          properties: {
            output: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  asset_name: { type: 'string' },
                  asset_type_name: { type: 'string' },
                  serial_number: { type: 'string' },
                  model_number: { type: 'string' },
                  condition: { type: 'string' },
                  purchase_date: { type: 'string' },
                  purchase_cost: { type: 'number' },
                  warranty_expiry: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
      });
      const records = result.output || [];
      if (records.length === 0) {
        setImportResults({ success: 0, errors: ['No asset records found in file.'] });
        return;
      }
      let success = 0;
      const errors = [];
      for (const row of records) {
        try {
          const type = assetTypes.find(t => t.name?.toLowerCase() === (row.asset_type_name || '').toLowerCase());
          if (!type) { errors.push(`Unknown asset type "${row.asset_type_name}" for "${row.asset_name}"`); continue; }
          const data = {
            asset_name: row.asset_name,
            asset_type_id: type.id,
            asset_type_name: type.name,
            serial_number: row.serial_number || '',
            model_number: row.model_number || '',
            condition: ['new', 'good', 'fair', 'poor', 'damaged'].includes(row.condition?.toLowerCase()) ? row.condition.toLowerCase() : 'good',
            purchase_date: row.purchase_date || '',
            purchase_cost: parseFloat(row.purchase_cost) || 0,
            warranty_expiry: row.warranty_expiry || '',
            notes: row.notes || '',
            status: 'available',
          };
          data.asset_id = generateAssetId(type.id);
          await base44.entities.Asset.create(data);
          success++;
        } catch (e) { errors.push(`${row.asset_name}: ${e.message}`); }
      }
      setImportResults({ success, errors });
      if (success > 0) loadData();
    } catch (err) { setImportResults({ success: 0, errors: [err.message || 'Import failed'] }); }
    setImporting(false);
  };

  const resetImport = () => {
    setImportFile(null);
    setImportResults(null);
  };

  // --- Bulk Export ---
  const exportToCSV = (filename, headers, rows) => {
    const escape = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(','), ...rows.map(r => headers.map(h => escape(r[h] || '')).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filename} downloaded`);
  };

  const handleExportAvailable = () => {
    const available = assets.filter(a => a.status === 'available' || a.status === 'unassigned');
    if (available.length === 0) { toast.error('No available assets to export'); return; }
    const headers = ['asset_id', 'asset_name', 'asset_type_name', 'serial_number', 'model_number', 'condition', 'purchase_date', 'purchase_cost', 'warranty_expiry', 'status', 'notes'];
    const rows = available.map(a => ({
      asset_id: a.asset_id, asset_name: a.asset_name, asset_type_name: a.asset_type_name || getTypeName(a.asset_type_id),
      serial_number: a.serial_number, model_number: a.model_number, condition: a.condition,
      purchase_date: a.purchase_date, purchase_cost: a.purchase_cost, warranty_expiry: a.warranty_expiry, status: a.status, notes: a.notes,
    }));
    exportToCSV(`Available_Assets_${format(new Date(), 'yyyy-MM-dd')}.csv`, headers, rows);
  };

  const handleExportAssigned = () => {
    const assigned = assets.filter(a => a.status === 'assigned' && a.assigned_to_user_id);
    if (assigned.length === 0) { toast.error('No assigned assets to export'); return; }
    const headers = ['asset_id', 'asset_name', 'asset_type_name', 'serial_number', 'model_number', 'condition', 'employee_name', 'employee_code', 'department', 'designation', 'assignment_date', 'return_date', 'is_temporary', 'temporary_reason'];
    const rows = assigned.map(a => {
      const emp = getEmployee(a.assigned_to_user_id);
      return {
        asset_id: a.asset_id, asset_name: a.asset_name, asset_type_name: a.asset_type_name || getTypeName(a.asset_type_id),
        serial_number: a.serial_number, model_number: a.model_number, condition: a.condition,
        employee_name: emp?.display_name || getEmployeeName(a.assigned_to_user_id),
        employee_code: emp?.employee_code || '',
        department: emp?.department || '',
        designation: emp?.designation || '',
        assignment_date: a.assignment_date, return_date: a.return_date,
        is_temporary: a.is_temporary ? 'Yes' : 'No',
        temporary_reason: a.temporary_reason || '',
      };
    });
    exportToCSV(`Assigned_Assets_${format(new Date(), 'yyyy-MM-dd')}.csv`, headers, rows);
  };

  const handlePrintAllForEmployee = (userId) => {
    const emp = getEmployee(userId);
    if (!emp) { toast.error('Employee record not found'); return; }
    const empAssets = assets.filter(a => a.assigned_to_user_id === userId && a.status === 'assigned');
    if (empAssets.length === 0) { toast.error('No assets assigned to this employee'); return; }
    openLetterheadPrintWindow(`Asset Letter - ${emp.display_name}`, buildAssetLetterContent(emp, empAssets), '', false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Asset Tracking</h1>
            <p className="text-muted-foreground text-sm mt-1">Inventory management — track and assign company assets</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={handleExportAvailable}><Download className="w-4 h-4 mr-2" />Available</Button>
            <Button variant="outline" onClick={handleExportAssigned}><Download className="w-4 h-4 mr-2" />Assigned</Button>
            <Button variant="outline" onClick={() => setShowImportDialog(true)}><Upload className="w-4 h-4 mr-2" />Import</Button>
            <Button variant="outline" onClick={openNewType}><Tags className="w-4 h-4 mr-2" />Types</Button>
            <Button onClick={() => openNewAsset(null)}><Plus className="w-4 h-4 mr-2" />Add Asset</Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total Assets', value: stats.total, icon: Boxes, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
            { label: 'Available', value: stats.available, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
            { label: 'Assigned', value: stats.assigned, icon: UserCheck, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
            { label: 'Under Repair', value: stats.underRepair, icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
            { label: 'Overdue Returns', value: stats.overdueReturns, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
          ].map(s => (
            <Card key={s.label} className={`${s.bg} border-0`}>
              <CardContent className="p-4 flex items-center gap-3">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <div><p className={`text-2xl font-bold ${s.color}`}>{s.value}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Overdue Return Alerts */}
        {stats.overdueReturns > 0 && (
          <Card className="border-red-200 bg-red-50/50 dark:bg-red-900/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" /> Overdue Returns ({stats.overdueReturns})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {assets.filter(a => a.status === 'assigned' && a.return_date && isBefore(parseISO(a.return_date), new Date())).slice(0, 5).map(a => (
                  <div key={a.id} className="flex items-center justify-between text-sm bg-white dark:bg-gray-800 rounded p-2 border">
                    <span className="font-medium">{a.asset_id} — {a.asset_name}</span>
                    <span className="text-gray-500">{getEmployeeName(a.assigned_to_user_id)}</span>
                    <Badge className="bg-red-100 text-red-800">Due: {format(parseISO(a.return_date), 'dd MMM yyyy')}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Inventory grouped by type */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">Inventory</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {assetTypes.map(type => {
                const group = groupedAssets[type.id] || { total: 0, available: 0, assigned: 0, underRepair: 0, assets: [] };
                const Icon = getTypeIcon(type.icon);
                return (
                  <Card key={type.id} className="hover:shadow-md transition-shadow cursor-pointer border" onClick={() => { setSelectedTypeId(type.id); setFilterStatus('all'); setSearch(''); }}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-primary/10 rounded-lg"><Icon className="w-4 h-4 text-primary" /></div>
                          <p className="font-semibold text-sm">{type.name}</p>
                        </div>
                        <Badge variant="outline" className="text-xs">{type.code}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-muted rounded p-2 text-center">
                          <p className="text-lg font-bold">{group.total}</p>
                          <p className="text-muted-foreground">Total</p>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 rounded p-2 text-center">
                          <p className="text-lg font-bold text-green-700 dark:text-green-400">{group.available}</p>
                          <p className="text-green-600 dark:text-green-400">Available</p>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-2 text-center">
                          <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{group.assigned}</p>
                          <p className="text-blue-600 dark:text-blue-400">Assigned</p>
                        </div>
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-2 text-center">
                          <p className="text-lg font-bold text-yellow-700 dark:text-yellow-400">{group.underRepair}</p>
                          <p className="text-yellow-600 dark:text-yellow-400">Repair</p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={(e) => { e.stopPropagation(); openNewAsset(type.id); }}>
                          <Plus className="w-3 h-3 mr-1" />Add
                        </Button>
                        <Button size="sm" variant="ghost" className="text-xs" onClick={(e) => { e.stopPropagation(); openEditType(type); }}>
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {/* Add new type card */}
              <Card className="hover:shadow-md transition-shadow cursor-pointer border-dashed border-2" onClick={openNewType}>
                <CardContent className="p-4 flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground">
                  <Plus className="w-8 h-8 mb-2" />
                  <p className="text-sm font-medium">Create Asset Type</p>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        {/* Employee-wise Asset Summary */}
        {(() => {
          const empAssetMap = {};
          assets.filter(a => a.status === 'assigned' && a.assigned_to_user_id).forEach(a => {
            if (!empAssetMap[a.assigned_to_user_id]) empAssetMap[a.assigned_to_user_id] = [];
            empAssetMap[a.assigned_to_user_id].push(a);
          });
          const empEntries = Object.entries(empAssetMap);
          if (empEntries.length === 0) return null;
          return (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" /> Employee Asset Assignments
                  <Badge variant="secondary" className="text-xs">{empEntries.length} employee{empEntries.length !== 1 ? 's' : ''}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {empEntries.map(([userId, empAssets]) => {
                    const emp = getEmployee(userId);
                    return (
                      <Card key={userId} className="border">
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="font-semibold text-sm">{emp?.display_name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{emp?.employee_code} · {emp?.designation || '—'}</p>
                            </div>
                            <Badge>{empAssets.length} asset{empAssets.length !== 1 ? 's' : ''}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-0.5 mb-3">
                            {empAssets.map(a => (
                              <div key={a.id} className="flex items-center gap-1">
                                <span className="font-mono text-primary">{a.asset_id}</span>
                                <span>— {a.asset_name}</span>
                                {a.is_temporary && <Badge className="text-[9px] bg-orange-100 text-orange-700 py-0">Temp</Badge>}
                              </div>
                            ))}
                          </div>
                          <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => handlePrintAllForEmployee(userId)}>
                            <PrinterIcon className="w-3 h-3 mr-1" /> Print All Assets Letter
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Asset list with filters */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-lg flex items-center gap-2">
                {selectedTypeId ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedTypeId(null)} className="p-0 h-auto">
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    {getTypeName(selectedTypeId)} Assets
                  </>
                ) : 'All Assets'}
                <Badge variant="secondary" className="text-xs ml-1">{filteredAssets.length}</Badge>
              </CardTitle>
              <div className="flex gap-2 flex-wrap items-center">
                <div className="relative w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input className="pl-9" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="under_repair">Under Repair</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    <SelectItem value="discarded">Discarded</SelectItem>
                  </SelectContent>
                </Select>
                {selectedTypeId && (
                  <Button size="sm" onClick={() => openNewAsset(selectedTypeId)}>
                    <Plus className="w-3 h-3 mr-1" /> Add {getTypeName(selectedTypeId)}
                  </Button>
                )}
                {filteredAssets.some(a => a.status === 'available') && (
                  <Button size="sm" variant="ghost" className="text-xs" onClick={selectAllFiltered}>
                    {bulkSelected.size > 0 ? 'Deselect All' : 'Select All Available'}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Bulk Selection Bar */}
            {bulkSelected.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <span className="text-sm font-medium">{bulkSelected.size} selected</span>
                <Popover open={bulkEmpOpen} onOpenChange={setBulkEmpOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" className="flex items-center justify-between rounded-md border border-input bg-background px-2 py-1 text-xs h-8 w-48 hover:bg-accent">
                      <span className={bulkEmployeeId ? 'text-foreground truncate' : 'text-muted-foreground'}>
                        {bulkEmployeeId === '__common__' ? '📦 Common Asset' : bulkEmployeeId ? (employees.find(e => e.user_id === bulkEmployeeId)?.display_name || bulkEmployeeId) : 'Pick employee...'}
                      </span>
                      <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[260px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search employee..." />
                      <CommandList>
                        <CommandEmpty>No employee found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem value="common asset" onSelect={() => { setBulkEmployeeId('__common__'); setBulkEmpOpen(false); }}>
                            <Check className={`mr-2 h-4 w-4 ${bulkEmployeeId === '__common__' ? 'opacity-100' : 'opacity-0'}`} /> 📦 Common Asset
                          </CommandItem>
                          {employees.filter(e => e.status === 'active').map(e => (
                            <CommandItem key={e.user_id} value={`${e.display_name || ''} ${e.employee_code || ''}`} onSelect={() => { setBulkEmployeeId(e.user_id); setBulkEmpOpen(false); }}>
                              <Check className={`mr-2 h-4 w-4 ${bulkEmployeeId === e.user_id ? 'opacity-100' : 'opacity-0'}`} />
                              {e.display_name} ({e.employee_code})
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button size="sm" disabled={!bulkEmployeeId || bulkAssigning} onClick={handleBulkAssign}>
                  {bulkAssigning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UserCheck className="w-3 h-3 mr-1" />}
                  Assign & Print Letter
                </Button>
                <Button size="sm" variant="ghost" onClick={clearBulkSelection}>Cancel</Button>
              </div>
            )}
            {filteredAssets.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No assets found</p>
            ) : (
              <div className="space-y-2">
                {filteredAssets.map(asset => {
                  const emp = getEmployee(asset.assigned_to_user_id);
                  const Icon = getTypeIcon(assetTypes.find(t => t.id === asset.asset_type_id)?.icon);
                  const isOverdue = asset.status === 'assigned' && asset.return_date && isBefore(parseISO(asset.return_date), new Date());
                  return (
                    <div key={asset.id} className="flex flex-wrap items-center justify-between border rounded-lg p-3 hover:bg-muted/30 transition-colors gap-2">
                      <div className="flex items-center gap-3">
                        {asset.status === 'available' && (
                          <input type="checkbox" className="w-4 h-4 rounded accent-blue-600 cursor-pointer" checked={bulkSelected.has(asset.id)} onChange={() => toggleBulkSelect(asset.id)} />
                        )}
                        <div className="p-2 bg-primary/10 rounded-lg"><Icon className="w-4 h-4 text-primary" /></div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">{asset.asset_name}</p>
                            <Badge className={STATUS_COLORS[asset.status]}>{asset.status?.replace('_', ' ')}</Badge>
                            <Badge className={CONDITION_COLORS[asset.condition]}>{asset.condition}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            <span className="font-mono text-primary">{asset.asset_id}</span>
                            {asset.model_number && <> · Model: {asset.model_number}</>}
                            {asset.serial_number && <> · SN: {asset.serial_number}</>}
                          </p>
                          {emp && (
                            <p className="text-xs text-muted-foreground">
                              Assigned: <span className="font-medium">{emp.display_name}</span> ({emp.employee_code})
                              {asset.assignment_date && <> · Since {format(parseISO(asset.assignment_date), 'dd MMM yyyy')}</>}
                              {isOverdue && <Badge className="ml-1 bg-red-100 text-red-700 text-[10px]">Overdue</Badge>}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 items-center flex-wrap">
                        {asset.is_temporary && (
                          <Badge className="bg-orange-100 text-orange-700 text-[10px]"><Clock className="w-3 h-3 mr-0.5" />Temporary</Badge>
                        )}
                        {asset.status === 'assigned' ? (
                          <>
                            <Button size="xs" variant="outline" className="h-7 text-xs" onClick={() => handlePrintLetter(asset)}>
                              <Download className="w-3 h-3 mr-1" /> Letter
                            </Button>
                            <Button size="xs" variant="outline" className="h-7 text-xs text-green-600" onClick={() => openReturnDialog(asset)}>
                              <RotateCcw className="w-3 h-3 mr-1" /> Return
                            </Button>
                            <Button size="xs" variant="ghost" className="h-7 text-xs text-orange-600" onClick={() => handleUnassignAsset(asset)}>
                              <UserX className="w-3 h-3" />
                            </Button>
                          </>
                        ) : (
                          <Popover open={!!assetAssignOpen[asset.id]} onOpenChange={open => setAssetAssignOpen(prev => ({ ...prev, [asset.id]: open }))}>
                            <PopoverTrigger asChild>
                              <button type="button" className="flex items-center justify-between rounded-md border border-input bg-background px-2 py-0.5 text-xs h-7 w-32 hover:bg-accent">
                                <span className="text-muted-foreground truncate">Assign...</span>
                                <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[240px] p-0" align="end">
                              <Command>
                                <CommandInput placeholder="Search employee..." />
                                <CommandList>
                                  <CommandEmpty>No employee found.</CommandEmpty>
                                  <CommandGroup>
                                    <CommandItem value="common asset" onSelect={() => { handleAssignEmployee(asset, '__common__'); setAssetAssignOpen(prev => ({ ...prev, [asset.id]: false })); }}>
                                      📦 Common Asset
                                    </CommandItem>
                                    {employees.filter(e => e.status === 'active').map(e => (
                                      <CommandItem key={e.user_id} value={`${e.display_name || ''} ${e.employee_code || ''}`} onSelect={() => { handleAssignEmployee(asset, e.user_id); setAssetAssignOpen(prev => ({ ...prev, [asset.id]: false })); }}>
                                        {e.display_name}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        )}
                        <Button size="xs" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditAsset(asset)}><Edit2 className="w-3 h-3" /></Button>
                        <Button size="xs" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => handleDeleteAsset(asset.id, asset.asset_name)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Asset Dialog */}
      <Dialog open={showAssetDialog} onOpenChange={setShowAssetDialog}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingAsset ? 'Edit Asset' : 'Add New Asset'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Asset Type *</Label>
                <Select value={assetForm.asset_type_id || '_none'} onValueChange={v => v !== '_none' && handleAssetFormTypeChange(v)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Select type...</SelectItem>
                    {assetTypes.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name} ({t.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Asset Name/Model *</Label>
                <Input value={assetForm.asset_name} onChange={e => setAssetForm({...assetForm, asset_name: e.target.value})} placeholder="e.g., Dell Latitude 5540" />
              </div>
              <div><Label>Asset ID</Label><Input value={assetForm.asset_id} onChange={e => setAssetForm({...assetForm, asset_id: e.target.value})} placeholder="Auto-generated" /></div>
              <div><Label>Model Number</Label><Input value={assetForm.model_number} onChange={e => setAssetForm({...assetForm, model_number: e.target.value})} placeholder="e.g., P127F" /></div>
              <div><Label>Serial Number</Label><Input value={assetForm.serial_number} onChange={e => setAssetForm({...assetForm, serial_number: e.target.value})} /></div>
              <div><Label>Condition</Label>
                <Select value={assetForm.condition} onValueChange={v => setAssetForm({...assetForm, condition: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['new','good','fair','poor','damaged'].map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Assign To</Label>
                <Popover open={assetDialogEmpOpen} onOpenChange={setAssetDialogEmpOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" className="mt-0.5 flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent">
                      <span className={assetForm.assigned_to_user_id ? 'text-foreground truncate' : 'text-muted-foreground'}>
                        {assetForm.assigned_to_user_id === '__common__' ? '📦 Common Asset (Shared)' : assetForm.assigned_to_user_id ? (employees.find(e => e.user_id === assetForm.assigned_to_user_id)?.display_name || assetForm.assigned_to_user_id) : 'Unassigned'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search employee..." />
                      <CommandList>
                        <CommandEmpty>No employee found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem value="unassigned" onSelect={() => { setAssetForm({...assetForm, assigned_to_user_id: '', status: 'available'}); setAssetDialogEmpOpen(false); }}>
                            <Check className={`mr-2 h-4 w-4 ${!assetForm.assigned_to_user_id ? 'opacity-100' : 'opacity-0'}`} /> Unassigned
                          </CommandItem>
                          <CommandItem value="common asset shared" onSelect={() => { setAssetForm({...assetForm, assigned_to_user_id: '__common__', status: 'assigned'}); setAssetDialogEmpOpen(false); }}>
                            <Check className={`mr-2 h-4 w-4 ${assetForm.assigned_to_user_id === '__common__' ? 'opacity-100' : 'opacity-0'}`} /> 📦 Common Asset (Shared)
                          </CommandItem>
                          {employees.filter(e => e.status === 'active').map(e => (
                            <CommandItem key={e.user_id} value={`${e.display_name || ''} ${e.employee_code || ''}`} onSelect={() => { setAssetForm({...assetForm, assigned_to_user_id: e.user_id, status: 'assigned'}); setAssetDialogEmpOpen(false); }}>
                              <Check className={`mr-2 h-4 w-4 ${assetForm.assigned_to_user_id === e.user_id ? 'opacity-100' : 'opacity-0'}`} />
                              {e.display_name} ({e.employee_code})
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div><Label>Assignment Date</Label><Input type="date" value={assetForm.assignment_date} onChange={e => setAssetForm({...assetForm, assignment_date: e.target.value})} /></div>
              <div><Label>Return Date</Label><Input type="date" value={assetForm.return_date} onChange={e => setAssetForm({...assetForm, return_date: e.target.value})} /></div>
              <div className="col-span-2 flex items-center gap-3 pt-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={assetForm.is_temporary} onChange={e => setAssetForm({...assetForm, is_temporary: e.target.checked})} className="rounded" />
                  Temporary Asset
                </label>
                {assetForm.is_temporary && (
                  <Input className="flex-1" placeholder="Reason (e.g., original under repair)" value={assetForm.temporary_reason || ''} onChange={e => setAssetForm({...assetForm, temporary_reason: e.target.value})} />
                )}
              </div>
              <div><Label>Purchase Date</Label><Input type="date" value={assetForm.purchase_date} onChange={e => setAssetForm({...assetForm, purchase_date: e.target.value})} /></div>
              <div><Label>Purchase Cost (₹)</Label><Input type="number" value={assetForm.purchase_cost} onChange={e => setAssetForm({...assetForm, purchase_cost: e.target.value})} /></div>
              <div><Label>Warranty Expiry</Label><Input type="date" value={assetForm.warranty_expiry} onChange={e => setAssetForm({...assetForm, warranty_expiry: e.target.value})} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={assetForm.notes} onChange={e => setAssetForm({...assetForm, notes: e.target.value})} rows={2} /></div>
            <Button onClick={handleSaveAsset} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {editingAsset ? 'Update Asset' : 'Add Asset'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Maintenance Log Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wrench className="w-5 h-5 text-primary" /> Maintenance History
            </CardTitle>
            <Select value="_none" onValueChange={(v) => { if (v !== '_none') { const a = assets.find(x => x.id === v); if (a) openMaintenanceDialog(a); } }}>
              <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="+ Log for asset..." /></SelectTrigger>
              <SelectContent>
                {assets.map(a => <SelectItem key={a.id} value={a.id}>{a.asset_id} — {a.asset_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {maintenanceLogs.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No maintenance records yet. Select an asset above to log service history.</p>
          ) : (
            <div className="space-y-2">
              {maintenanceLogs.slice(0, 50).map(log => {
                const asset = assets.find(a => a.id === log.asset_id);
                return (
                  <div key={log.id} className="flex flex-wrap items-center justify-between border rounded-lg p-3 hover:bg-muted/30 gap-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-orange-100 dark:bg-orange-900/20 rounded-lg"><Wrench className="w-4 h-4 text-orange-600" /></div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{asset?.asset_name || 'Unknown'} <span className="font-mono text-xs text-muted-foreground">({asset?.asset_id})</span></p>
                          <Badge className={maintenanceTypeColors[log.maintenance_type]}>{log.maintenance_type}</Badge>
                          <Badge className={maintenanceStatusColors[log.status]}>{log.status.replace('_', ' ')}</Badge>
                          {log.warranty_covered && <Badge className="bg-teal-100 text-teal-800 text-[10px]">Warranty</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {log.service_date && <span>{format(parseISO(log.service_date), 'dd MMM yyyy')}</span>}
                          {log.completion_date && <span> → {format(parseISO(log.completion_date), 'dd MMM yyyy')}</span>}
                          {log.vendor_name && <span> · {log.vendor_name}</span>}
                          {log.cost > 0 && <span className="font-semibold text-foreground"> · ₹{log.cost.toLocaleString('en-IN')}</span>}
                        </p>
                        {log.description && <p className="text-xs text-muted-foreground mt-0.5 italic">"{log.description}"</p>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="xs" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditMaintenance(log)}><Edit2 className="w-3 h-3" /></Button>
                      <Button size="xs" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => handleDeleteMaintenance(log.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>
                );
              })}
              {maintenanceLogs.length > 50 && <p className="text-xs text-muted-foreground text-center py-2">Showing 50 of {maintenanceLogs.length} records</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity Log Section */}
      <AssetActivityLog logs={activityLogs} />

      {/* Return Dialog */}
      <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Return Asset</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Returning: <span className="font-semibold text-foreground">{returningAsset?.asset_name}</span>
              {returningAsset?.asset_id && <span className="font-mono text-xs ml-1">({returningAsset.asset_id})</span>}
            </p>
            <div>
              <Label>Returned Condition</Label>
              <Select value={returnForm.returned_condition} onValueChange={v => setReturnForm({...returnForm, returned_condition: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['new','good','fair','poor','damaged'].map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Return Date</Label>
              <Input type="date" value={returnForm.returned_date} onChange={e => setReturnForm({...returnForm, returned_date: e.target.value})} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={returnForm.notes} onChange={e => setReturnForm({...returnForm, notes: e.target.value})} rows={2} placeholder="Any remarks on condition..." />
            </div>
            <Button onClick={handleConfirmReturn} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
              Confirm Return
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Maintenance Dialog */}
      <Dialog open={showMaintenanceDialog} onOpenChange={setShowMaintenanceDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingMaintenance ? 'Edit Maintenance Log' : 'Add Maintenance Log'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {selectedAssetForMaintenance && (
              <p className="text-sm text-muted-foreground bg-muted p-2 rounded">
                Asset: <span className="font-semibold">{selectedAssetForMaintenance.asset_name}</span> <span className="font-mono text-xs">({selectedAssetForMaintenance.asset_id})</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Maintenance Type *</Label>
                <Select value={maintenanceForm.maintenance_type} onValueChange={v => setMaintenanceForm({...maintenanceForm, maintenance_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['repair','service','upgrade','inspection','replacement','other'].map(t => (
                      <SelectItem key={t} value={t}>{t.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={maintenanceForm.status} onValueChange={v => setMaintenanceForm({...maintenanceForm, status: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['pending','in_progress','completed','cancelled'].map(s => (
                      <SelectItem key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Service Date *</Label><Input type="date" value={maintenanceForm.service_date} onChange={e => setMaintenanceForm({...maintenanceForm, service_date: e.target.value})} /></div>
              <div><Label>Completion Date</Label><Input type="date" value={maintenanceForm.completion_date} onChange={e => setMaintenanceForm({...maintenanceForm, completion_date: e.target.value})} /></div>
              <div><Label>Cost (₹)</Label><Input type="number" value={maintenanceForm.cost} onChange={e => setMaintenanceForm({...maintenanceForm, cost: e.target.value})} placeholder="0" /></div>
              <div><Label>Vendor Name</Label><Input value={maintenanceForm.vendor_name} onChange={e => setMaintenanceForm({...maintenanceForm, vendor_name: e.target.value})} placeholder="Service provider" /></div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={maintenanceForm.warranty_covered} onChange={e => setMaintenanceForm({...maintenanceForm, warranty_covered: e.target.checked})} className="rounded" id="warranty_cb" />
              <Label htmlFor="warranty_cb" className="cursor-pointer text-sm">Covered under warranty</Label>
            </div>
            <div><Label>Description</Label><Textarea value={maintenanceForm.description} onChange={e => setMaintenanceForm({...maintenanceForm, description: e.target.value})} rows={2} placeholder="What was done..." /></div>
            <div><Label>Parts Replaced</Label><Input value={maintenanceForm.parts_replaced} onChange={e => setMaintenanceForm({...maintenanceForm, parts_replaced: e.target.value})} placeholder="e.g., Battery, Screen" /></div>
            <div><Label>Technician Notes</Label><Textarea value={maintenanceForm.technician_notes} onChange={e => setMaintenanceForm({...maintenanceForm, technician_notes: e.target.value})} rows={2} /></div>
            <Button onClick={handleSaveMaintenance} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {editingMaintenance ? 'Update Log' : 'Add Log'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Import Assets from CSV</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!importResults ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Upload a CSV or Excel file with asset details. The file should have columns like:
                  <span className="block mt-1 text-xs font-mono text-foreground/70">
                    asset_name, asset_type_name, serial_number, model_number, condition, purchase_date, purchase_cost, warranty_expiry, notes
                  </span>
                  <span className="block mt-1 text-xs">Asset types must already exist in the system.</span>
                </p>
                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                  {importFile ? (
                    <div className="space-y-2">
                      <FileSpreadsheet className="w-8 h-8 mx-auto text-green-600" />
                      <p className="text-sm font-medium">{importFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(importFile.size / 1024).toFixed(1)} KB</p>
                      <Button size="sm" variant="ghost" onClick={resetImport}>Remove</Button>
                    </div>
                  ) : (
                    <label className="cursor-pointer block">
                      <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                      <p className="text-sm font-medium">Click to upload file</p>
                      <p className="text-xs text-muted-foreground">CSV, XLSX, XLS</p>
                      <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleImportFileSelect} />
                    </label>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-600 font-semibold">
                  <CheckCircle2 className="w-5 h-5" /> Import Complete
                </div>
                <p className="text-sm">{importResults.success} asset(s) imported successfully.</p>
                {importResults.errors?.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 max-h-32 overflow-y-auto space-y-1">
                    {importResults.errors.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
                <Button variant="outline" className="w-full" onClick={() => { setShowImportDialog(false); resetImport(); }}>
                  Close
                </Button>
              </div>
            )}
            {!importResults && (
              <Button onClick={handleImport} disabled={!importFile || importing} className="w-full">
                {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {importing ? 'Importing...' : 'Import Assets'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Asset Type Dialog */}
      <Dialog open={showTypeDialog} onOpenChange={setShowTypeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingType ? 'Edit Asset Type' : 'Create Asset Type'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={typeForm.name} onChange={e => setTypeForm({...typeForm, name: e.target.value})} placeholder="e.g., Laptop" /></div>
            <div><Label>Code *</Label><Input value={typeForm.code} onChange={e => setTypeForm({...typeForm, code: e.target.value.toUpperCase()})} placeholder="e.g., LAP" maxLength={5} /></div>
            <div><Label>Icon</Label>
              <Select value={typeForm.icon} onValueChange={v => setTypeForm({...typeForm, icon: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['laptop','desktop','monitor','keyboard','mouse','smartphone','headphones','printer','router','hard_drive','usb','cable','sim','tablet','chair','desk','other'].map(i => (
                    <SelectItem key={i} value={i}>{i.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea value={typeForm.description} onChange={e => setTypeForm({...typeForm, description: e.target.value})} rows={2} /></div>
            <div className="flex gap-2">
              <Button onClick={handleSaveType} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {editingType ? 'Update' : 'Create'}
              </Button>
              {editingType && (
                <Button variant="destructive" onClick={() => handleDeleteType(editingType)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}