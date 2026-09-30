import { X, Package } from 'lucide-react';
import { BaseModal } from '../../common/components/modal/BaseModal';
import { LibraryListSidebar } from './LibraryListSidebar';
import { LibraryCreateForm } from './LibraryCreateForm';
import { LibraryIconForm } from './LibraryIconForm';
import { LibraryShapeForm } from './LibraryShapeForm';
import { LibraryDetails } from './LibraryDetails';
import {
  useLibraryManager,
  libraryManagerHandlers,
  type LibraryManagerModalProps,
} from './useLibraryManager';

/**
 * Manages shape and icon libraries: which are enabled, importing and
 * exporting them, and creating custom ones.
 *
 * State lives in useLibraryManager, actions in libraryManagerHandlers; the
 * sidebar, each form and the library details are their own components,
 * each receiving exactly the state it reads.
 */
export function LibraryManagerModal({ isOpen, onClose }: LibraryManagerModalProps) {
  const state = useLibraryManager({ isOpen });

  if (!isOpen) return null;

  // PERFORMANCE: after the early return on purpose - this modal is always
  // mounted and renders with App while closed. See libraryManagerHandlers.
  const {
    selectedLib,
    handleToggleLibrary,
    handleDeleteLibrary,
    handleImportFile,
    handleCreateLibrary,
    handleCreateIcon,
    handleCreateShape,
  } = libraryManagerHandlers(state);
  const {
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
    isAddingShape,
    setIsAddingShape,
    newShapeName,
    setNewShapeName,
    newShapeCategory,
    setNewShapeCategory,
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
  } = state;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Shape & Icon Libraries"
      className="modal-content"
      padding={0}
      style={{
        width: 860,
        maxWidth: '95vw',
        height: 620,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        border: '1px solid var(--chrome-border)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: '1px solid var(--chrome-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Package size={18} style={{ color: 'var(--accent)' }} />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Shape & Icon Libraries</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--chrome-text-dim)',
            cursor: 'pointer',
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Validation result banner */}
      {validationResult && (
        <div
          style={{
            padding: '10px 16px',
            background: validationResult.valid
              ? 'rgba(15, 163, 107, 0.15)'
              : 'rgba(240, 87, 140, 0.15)',
            borderBottom: '1px solid var(--chrome-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 13,
          }}
        >
          <div>
            <strong>{validationResult.valid ? 'Import Successful' : 'Import Failed'}</strong>:{' '}
            {validationResult.importedShapesCount} shape(s), {validationResult.importedIconsCount}{' '}
            icon(s) imported.
            {validationResult.errors.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--chrome-text-dim)', marginTop: 2 }}>
                {validationResult.errors.join('; ')}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setValidationResult(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--chrome-text)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Sidebar: Library List */}
        <LibraryListSidebar
          libraries={libraries}
          selectedLibId={selectedLibId}
          setSelectedLibId={setSelectedLibId}
          setIsCreatingLib={setIsCreatingLib}
          setIsAddingIcon={setIsAddingIcon}
          setIsAddingShape={setIsAddingShape}
          fileInputRef={fileInputRef}
          handleToggleLibrary={handleToggleLibrary}
          handleImportFile={handleImportFile}
        />

        {/* Right Content View */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: 18,
          }}
        >
          {isCreatingLib ? (
            <LibraryCreateForm
              setIsCreatingLib={setIsCreatingLib}
              newLibName={newLibName}
              setNewLibName={setNewLibName}
              newLibDesc={newLibDesc}
              setNewLibDesc={setNewLibDesc}
              newLibAuthor={newLibAuthor}
              setNewLibAuthor={setNewLibAuthor}
              newLibLicense={newLibLicense}
              setNewLibLicense={setNewLibLicense}
              handleCreateLibrary={handleCreateLibrary}
            />
          ) : isAddingIcon ? (
            <LibraryIconForm
              setIsAddingIcon={setIsAddingIcon}
              newIconName={newIconName}
              setNewIconName={setNewIconName}
              newIconCategory={newIconCategory}
              setNewIconCategory={setNewIconCategory}
              newIconTags={newIconTags}
              setNewIconTags={setNewIconTags}
              newIconSvg={newIconSvg}
              setNewIconSvg={setNewIconSvg}
              handleCreateIcon={handleCreateIcon}
            />
          ) : isAddingShape ? (
            <LibraryShapeForm
              setIsAddingShape={setIsAddingShape}
              newShapeName={newShapeName}
              setNewShapeName={setNewShapeName}
              newShapeCategory={newShapeCategory}
              setNewShapeCategory={setNewShapeCategory}
              newShapeGeomType={newShapeGeomType}
              setNewShapeGeomType={setNewShapeGeomType}
              newShapeSvgPath={newShapeSvgPath}
              setNewShapeSvgPath={setNewShapeSvgPath}
              newShapeWidth={newShapeWidth}
              setNewShapeWidth={setNewShapeWidth}
              newShapeHeight={newShapeHeight}
              setNewShapeHeight={setNewShapeHeight}
              newShapeColor={newShapeColor}
              setNewShapeColor={setNewShapeColor}
              newShapeIconId={newShapeIconId}
              setNewShapeIconId={setNewShapeIconId}
              handleCreateShape={handleCreateShape}
            />
          ) : selectedLib ? (
            <LibraryDetails
              setIsAddingIcon={setIsAddingIcon}
              setIsAddingShape={setIsAddingShape}
              selectedLib={selectedLib}
              handleDeleteLibrary={handleDeleteLibrary}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--chrome-text-dim)',
              }}
            >
              <Package size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p>Select a library from the left sidebar or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
