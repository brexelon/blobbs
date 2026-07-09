// SPDX-License-Identifier: AGPL-3.0-or-later

import type React from 'react';
import {DndProvider} from 'react-dnd';
import KeyboardBackend, {isKeyboardDragTrigger} from 'react-dnd-accessible-backend';
import {HTML5Backend} from 'react-dnd-html5-backend';
import {createTransition, MouseTransition, MultiBackend} from 'react-dnd-multi-backend';
import {TouchBackend} from 'react-dnd-touch-backend';

const KeyboardTransition = createTransition('keydown', (event: Event) => {
	if (!isKeyboardDragTrigger(event as KeyboardEvent)) return false;
	event.preventDefault();
	return true;
});
const DND_OPTIONS = {
	backends: [
		{
			id: 'html5',
			backend: HTML5Backend,
			transition: MouseTransition,
		},
		{
			id: 'keyboard',
			backend: KeyboardBackend,
			context: {window, document},
			preview: true,
			transition: KeyboardTransition,
		},
	],
};

// The HTML5 backend is mouse-only and marks drag sources with `draggable="true"`, which prevents
// touch scrolling of the community and channel lists on mobile and never produces a touch drag.
// On touch-primary devices we swap it for the touch backend instead. The touch backend uses touch
// listeners (no `draggable` attribute) and only calls `preventDefault()` once a drag has actually
// begun, so a quick swipe scrolls natively while a deliberate press-and-drag reorders items and
// lets folders be created. `enableMouseEvents`/`enableKeyboardEvents` keep hybrid input working.
const TOUCH_BACKEND_OPTIONS = {
	enableMouseEvents: true,
	enableKeyboardEvents: true,
	delayTouchStart: 160,
	ignoreContextMenu: true,
	touchSlop: 8,
};

const isTouchPrimaryDevice = (): boolean => {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(pointer: coarse)').matches;
};

// Resolved once for the session so the provider (which wraps the whole app) never has to remount.
const IS_TOUCH_PRIMARY = isTouchPrimaryDevice();

interface DndContextProps {
	children: React.ReactNode;
}

export const DndContext = ({children}: DndContextProps) => {
	if (IS_TOUCH_PRIMARY) {
		return (
			<DndProvider backend={TouchBackend} options={TOUCH_BACKEND_OPTIONS} data-flx="app.dnd-context.dnd-provider">
				{children}
			</DndProvider>
		);
	}
	return (
		<DndProvider backend={MultiBackend} options={DND_OPTIONS} data-flx="app.dnd-context.dnd-provider">
			{children}
		</DndProvider>
	);
};
