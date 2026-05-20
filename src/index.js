'use strict'

import { registerRoute } from '@/routes'
import DwcDebugTools from './DebugTools.vue'

registerRoute(DwcDebugTools, {
    Plugins: {
        DwcDebugTools: {
            icon: 'mdi-bug-outline',
            caption: 'Debug Tools',
            translated: false,
            path: '/DwcDebugTools'
        }
    }
})