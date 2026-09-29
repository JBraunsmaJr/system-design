import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import {
  globalAssetLibraryManager,
  type AssetLibrary,
  type LibraryValidationResult,
} from '../../domain/storage/assetLibrary';
import { sanitizeSvg, type IconDefinition } from '../../domain/canvas/iconRegistry';
import { type ShapeDefinition, DEFAULT_CONNECTION_POINTS } from '../../domain/canvas/shapeRegistry';

export interface LibraryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The library manager's state: the loaded libraries, the selection, and the
 * create-library, add-icon and add-shape forms. Moved unchanged from
 * LibraryManagerModal.tsx.
 *
 * Performance contract: this hook runs inside LibraryManagerModal's render,
 * so it adds no component and no render. It holds exactly what ran BEFORE
 * the modal's `if (!isOpen) return null;` - see libraryManagerHandlers for
 * why the rest does not live here.
 */
export function useLibraryManager({ isOpen }: Pick<LibraryManagerModalProps, 'isOpen'>) {
  const [libraries, setLibraries] = useState<AssetLibrary[]>([]);
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<LibraryValidationResult | null>(null);

  // New Library form state
  const [isCreatingLib, setIsCreatingLib] = useState(false);
  const [newLibName, setNewLibName] = useState('');
  const [newLibDesc, setNewLibDesc] = useState('');
  const [newLibAuthor, setNewLibAuthor] = useState('');
  const [newLibLicense, setNewLibLicense] = useState('');

  // New Icon form state
  const [isAddingIcon, setIsAddingIcon] = useState(false);
  const [newIconName, setNewIconName] = useState('');
  const [newIconCategory, setNewIconCategory] = useState('');
  const [newIconTags, setNewIconTags] = useState('');
  const [newIconSvg, setNewIconSvg] = useState(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
  );
  const [newIconAuthor, setNewIconAuthor] = useState('');
  const [newIconLicense, setNewIconLicense] = useState('');

  // New Shape form state
  const [isAddingShape, setIsAddingShape] = useState(false);
  const [newShapeName, setNewShapeName] = useState('');
  const [newShapeCategory, setNewShapeCategory] = useState('');
  const [newShapeTags, setNewShapeTags] = useState('');
  const [newShapeGeomType, setNewShapeGeomType] = useState<string>('rounded-rectangle');
  const [newShapeSvgPath, setNewShapeSvgPath] = useState('M 10 10 L 90 10 L 90 90 L 10 90 Z');
  const [newShapeWidth, setNewShapeWidth] = useState(140);
  const [newShapeHeight, setNewShapeHeight] = useState(90);
  const [newShapeColor, setNewShapeColor] = useState('#5B7CFA');
  const [newShapeIconId, setNewShapeIconId] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshLibraries = () => {
    const libs = globalAssetLibraryManager.getLibraries();
    setLibraries(libs);
    if (!selectedLibId && libs.length > 0) {
      setSelectedLibId(libs[0].library.id);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshLibraries();
    }
  }, [isOpen]);

  return {
    libraries,
    selectedLibId,
    setSelectedLibId,
    validationResult,
    setValidationResult,
    isCreatingLib,
    setIsCreatingLib,
    newLibName,
    setNewLibName,
    newLibDesc,
    setNewLibDesc,
    newLibAuthor,
    setNewLibAuthor,
    newLibLicense,
    setNewLibLicense,
    isAddingIcon,
    setIsAddingIcon,
    newIconName,
    setNewIconName,
    newIconCategory,
    setNewIconCategory,
    newIconTags,
    setNewIconTags,
    newIconSvg,
    setNewIconSvg,
    newIconAuthor,
    setNewIconAuthor,
    newIconLicense,
    setNewIconLicense,
    isAddingShape,
    setIsAddingShape,
    newShapeName,
    setNewShapeName,
    newShapeCategory,
    setNewShapeCategory,
    newShapeTags,
    setNewShapeTags,
    newShapeGeomType,
    setNewShapeGeomType,
    newShapeSvgPath,
    setNewShapeSvgPath,
    newShapeWidth,
    setNewShapeWidth,
    newShapeHeight,
    setNewShapeHeight,
    newShapeColor,
    setNewShapeColor,
    newShapeIconId,
    setNewShapeIconId,
    fileInputRef,
    refreshLibraries,
  };
}

export type LibraryManagerState = ReturnType<typeof useLibraryManager>;

/**
 * The selected library and every action the modal offers. Moved unchanged
 * from LibraryManagerModal.tsx, where this code ran after
 * `if (!isOpen) return null;`.
 *
 * PERFORMANCE: a plain function, not part of useLibraryManager, on purpose.
 * The modal is always mounted and re-renders with App - including on every
 * frame of a canvas drag - while closed. Only the hook runs on that path;
 * the component calls this after its early return, so a closed modal still
 * builds none of these handlers, exactly as before the split. It contains
 * no hooks, which is what makes calling it after a conditional return legal.
 */
export function libraryManagerHandlers({
  libraries,
  selectedLibId,
  setSelectedLibId,
  setValidationResult,
  setIsCreatingLib,
  newLibName,
  setNewLibName,
  newLibDesc,
  setNewLibDesc,
  newLibAuthor,
  setNewLibAuthor,
  newLibLicense,
  setNewLibLicense,
  setIsAddingIcon,
  newIconName,
  setNewIconName,
  newIconCategory,
  setNewIconCategory,
  newIconTags,
  setNewIconTags,
  newIconSvg,
  newIconAuthor,
  setNewIconAuthor,
  newIconLicense,
  setNewIconLicense,
  setIsAddingShape,
  newShapeName,
  setNewShapeName,
  newShapeCategory,
  setNewShapeCategory,
  newShapeTags,
  setNewShapeTags,
  newShapeGeomType,
  newShapeSvgPath,
  newShapeWidth,
  newShapeHeight,
  newShapeColor,
  newShapeIconId,
  setNewShapeIconId,
  refreshLibraries,
}: LibraryManagerState) {
  const selectedLib = libraries.find((l) => l.library.id === selectedLibId);

  const handleToggleLibrary = (id: string, currentEnabled?: boolean) => {
    globalAssetLibraryManager.setLibraryEnabled(id, !currentEnabled);
    refreshLibraries();
  };

  const handleDeleteLibrary = (id: string) => {
    if (confirm('Are you sure you want to delete this custom library?')) {
      globalAssetLibraryManager.deleteLibrary(id);
      setSelectedLibId(null);
      refreshLibraries();
    }
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const result = globalAssetLibraryManager.importLibraryFromJson(content);
        setValidationResult(result);
        refreshLibraries();
        if (result.library) {
          setSelectedLibId(result.library.library.id);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCreateLibrary = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLibName.trim()) return;

    const newId = `custom-lib-${Date.now()}`;
    const newLib: AssetLibrary = {
      format: 'system-design-library',
      version: 1,
      library: {
        id: newId,
        name: newLibName.trim(),
        description: newLibDesc.trim() || undefined,
        version: 1,
        author: newLibAuthor.trim() || undefined,
        license: newLibLicense.trim() || undefined,
      },
      icons: [],
      shapes: [],
      enabled: true,
    };

    globalAssetLibraryManager.addOrUpdateLibrary(newLib);
    setIsCreatingLib(false);
    setNewLibName('');
    setNewLibDesc('');
    setNewLibAuthor('');
    setNewLibLicense('');
    setSelectedLibId(newId);
    refreshLibraries();
  };

  const handleCreateIcon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLib || !newIconName.trim()) return;

    const iconId = `${selectedLib.library.id}.${newIconName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}`;
    const iconDef: IconDefinition = {
      id: iconId,
      name: newIconName.trim(),
      category: newIconCategory.trim() || selectedLib.library.name,
      tags: newIconTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      version: 1,
      source: {
        type: 'svg',
        data: sanitizeSvg(newIconSvg),
      },
      attribution:
        newIconAuthor || newIconLicense
          ? {
              author: newIconAuthor.trim() || undefined,
              license: newIconLicense.trim() || undefined,
            }
          : undefined,
      libraryId: selectedLib.library.id,
    };

    const updatedLib: AssetLibrary = {
      ...selectedLib,
      icons: [...selectedLib.icons.filter((i) => i.id !== iconId), iconDef],
    };

    globalAssetLibraryManager.addOrUpdateLibrary(updatedLib);
    setIsAddingIcon(false);
    setNewIconName('');
    setNewIconCategory('');
    setNewIconTags('');
    setNewIconAuthor('');
    setNewIconLicense('');
    refreshLibraries();
  };

  const handleCreateShape = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLib || !newShapeName.trim()) return;

    const shapeId = `${selectedLib.library.id}.${newShapeName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}`;

    let geom: ShapeDefinition['geometry'] = { type: 'rounded-rectangle', radius: 8 };
    if (newShapeGeomType === 'circle') geom = { type: 'circle' };
    else if (newShapeGeomType === 'rectangle') geom = { type: 'rectangle' };
    else if (newShapeGeomType === 'diamond') geom = { type: 'diamond' };
    else if (newShapeGeomType === 'cylinder') geom = { type: 'cylinder' };
    else if (newShapeGeomType === 'cloud') geom = { type: 'cloud' };
    else if (newShapeGeomType === 'actor') geom = { type: 'actor' };
    else if (newShapeGeomType === 'document') geom = { type: 'document' };
    else if (newShapeGeomType === 'hexagon') geom = { type: 'hexagon' };
    else if (newShapeGeomType === 'parallelogram') geom = { type: 'parallelogram' };
    else if (newShapeGeomType === 'path') geom = { type: 'path', d: newShapeSvgPath };

    const shapeDef: ShapeDefinition = {
      id: shapeId,
      name: newShapeName.trim(),
      category: newShapeCategory.trim() || selectedLib.library.name,
      tags: newShapeTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      version: 1,
      geometry: geom,
      defaults: {
        width: Number(newShapeWidth) || 140,
        height: Number(newShapeHeight) || 90,
        color: newShapeColor || '#5B7CFA',
        label: newShapeName.trim(),
      },
      connectionPoints: DEFAULT_CONNECTION_POINTS,
      iconId: newShapeIconId.trim() || undefined,
      libraryId: selectedLib.library.id,
    };

    const updatedLib: AssetLibrary = {
      ...selectedLib,
      shapes: [...selectedLib.shapes.filter((s) => s.id !== shapeId), shapeDef],
    };

    globalAssetLibraryManager.addOrUpdateLibrary(updatedLib);
    setIsAddingShape(false);
    setNewShapeName('');
    setNewShapeCategory('');
    setNewShapeTags('');
    setNewShapeIconId('');
    refreshLibraries();
  };

  return {
    selectedLib,
    handleToggleLibrary,
    handleDeleteLibrary,
    handleImportFile,
    handleCreateLibrary,
    handleCreateIcon,
    handleCreateShape,
  };
}

/** Everything the modal's sections read; each section picks its part. */
export type LibraryManagerView = LibraryManagerState & ReturnType<typeof libraryManagerHandlers>;
