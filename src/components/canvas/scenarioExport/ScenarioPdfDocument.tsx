import {Document, Image, Page, StyleSheet, Text, View} from '@react-pdf/renderer';
import {
    CAPTION_PADDING_X,
    CAPTION_PADDING_Y,
    FRAME_HEIGHT,
    FRAME_WIDTH,
    type FrameLayout,
} from '../../../domain/scenarioExport/scenarioExportPlan';
import {PDF_FONT_SANS} from '../../srd/pdf/srdPdfFonts';
import type {ExportTheme} from './composeFrame';

/** Slides are the frames' layout at half scale: 1920x1080 px -> 960x540 pt. */
const SCALE = 0.5;
const PAGE = {width: FRAME_WIDTH * SCALE, height: FRAME_HEIGHT * SCALE};

export interface PdfSlide {
    index: number;
    title: string;
    narration: string;
    levelLabel: string;
    /** JPEG data URL of the diagram, at the layout's diagram size. */
    image: string;
}

export interface ScenarioPdfProps {
    scenarioTitle: string;
    documentTitle: string;
    slides: PdfSlide[];
    layout: FrameLayout;
    titleSlide: boolean;
    theme: ExportTheme;
    /** False in tests that render without the bundled fonts. */
    fontsRegistered: boolean;
}

/**
 * A scenario as a slide deck: an optional title slide, then one slide per
 * step - the diagram as Presentation Mode shows it, with the step's title and
 * narration as real, selectable text.
 */
export function ScenarioPdfDocument({
                                        scenarioTitle,
                                        documentTitle,
                                        slides,
                                        layout,
                                        titleSlide,
                                        theme,
                                        fontsRegistered,
                                    }: ScenarioPdfProps) {
    const font = fontsRegistered ? PDF_FONT_SANS : 'Helvetica';
    const s = StyleSheet.create({
        page: {width: PAGE.width, height: PAGE.height, backgroundColor: theme.background},
        header: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: layout.headerHeight * SCALE,
            backgroundColor: theme.chrome,
            borderBottomWidth: 0.5,
            borderBottomColor: theme.border,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: CAPTION_PADDING_X * SCALE,
        },
        headerTitle: {fontFamily: font, fontWeight: 600, fontSize: 13, color: theme.text},
        headerLevel: {
            fontFamily: font,
            fontSize: 11,
            color: theme.textDim,
            marginLeft: 16,
            flexGrow: 1,
            flexShrink: 1,
        },
        headerProgress: {fontFamily: font, fontSize: 12, color: theme.textDim},
        diagram: {
            position: 'absolute',
            top: layout.diagram.y * SCALE,
            left: 0,
            width: layout.diagram.width * SCALE,
            height: layout.diagram.height * SCALE,
        },
        caption: {
            position: 'absolute',
            top: layout.caption.y * SCALE,
            left: 0,
            width: layout.caption.width * SCALE,
            height: layout.caption.height * SCALE,
            backgroundColor: theme.chrome,
            borderTopWidth: 0.5,
            borderTopColor: theme.border,
            borderLeftWidth: 4,
            borderLeftColor: theme.accent,
            paddingHorizontal: CAPTION_PADDING_X * SCALE - 4,
            paddingVertical: CAPTION_PADDING_Y * SCALE,
        },
        stepTitle: {fontFamily: font, fontWeight: 600, fontSize: 20, color: theme.text},
        narration: {
            fontFamily: font,
            fontSize: 14,
            lineHeight: 1.43,
            color: theme.textDim,
            marginTop: 6,
        },
        cover: {
            flexGrow: 1,
            paddingHorizontal: 64,
            paddingVertical: 56,
            borderLeftWidth: 6,
            borderLeftColor: theme.accent,
        },
        coverEyebrow: {
            fontFamily: font,
            fontSize: 11,
            color: theme.textDim,
            letterSpacing: 1.5,
            marginBottom: 8,
        },
        coverTitle: {fontFamily: font, fontWeight: 700, fontSize: 34, color: theme.text},
        coverMeta: {fontFamily: font, fontSize: 13, color: theme.textDim, marginTop: 8},
        coverList: {marginTop: 28},
        coverRow: {flexDirection: 'row', marginBottom: 6},
        coverNumber: {fontFamily: font, fontSize: 12, color: theme.accent, width: 28},
        coverStep: {fontFamily: font, fontSize: 12, color: theme.text, flexShrink: 1},
        coverLevel: {fontFamily: font, fontSize: 10, color: theme.textDim, marginLeft: 8},
    });

    return (
        <Document title={scenarioTitle} subject={documentTitle} creator="Engineers Notebook">
            {titleSlide && (
                <Page size={[PAGE.width, PAGE.height]} style={s.page}>
                    <View style={s.cover}>
                        <Text style={s.coverEyebrow}>SCENARIO</Text>
                        <Text style={s.coverTitle}>{scenarioTitle || 'Scenario'}</Text>
                        <Text style={s.coverMeta}>
                            {documentTitle ? `${documentTitle} · ` : ''}
                            {slides.length} {slides.length === 1 ? 'step' : 'steps'}
                        </Text>
                        <View style={s.coverList}>
                            {slides.map((slide) => (
                                <View key={slide.index} style={s.coverRow} wrap={false}>
                                    <Text style={s.coverNumber}>{slide.index + 1}</Text>
                                    <Text style={s.coverStep}>{slide.title}</Text>
                                    <Text style={s.coverLevel}>{slide.levelLabel}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                </Page>
            )}
            {slides.map((slide) => (
                <Page key={slide.index} size={[PAGE.width, PAGE.height]} style={s.page}>
                    <Image src={slide.image} style={s.diagram}/>
                    <View style={s.header}>
                        <Text style={s.headerTitle}>{scenarioTitle || 'Scenario'}</Text>
                        <Text style={[s.headerLevel, {maxLines: 1, textOverflow: 'ellipsis'}]}>
                            {slide.levelLabel}
                        </Text>
                        <Text style={s.headerProgress}>
                            Step {slide.index + 1} of {slides.length}
                        </Text>
                    </View>
                    <View style={s.caption}>
                        <Text style={[s.stepTitle, {maxLines: 1, textOverflow: 'ellipsis'}]}>
                            {slide.title}
                        </Text>
                        {slide.narration && layout.narrationLines > 0 ? (
                            <Text
                                style={[s.narration, {maxLines: layout.narrationLines, textOverflow: 'ellipsis'}]}
                            >
                                {slide.narration}
                            </Text>
                        ) : null}
                    </View>
                </Page>
            ))}
        </Document>
    );
}
