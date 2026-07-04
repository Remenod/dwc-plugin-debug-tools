<template>
  <v-container fluid>
    <v-card>
      <v-card-title>
        Duet Web Control Debug Tools
      </v-card-title>

      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          dense
          text
        >
          {{ error }}
        </v-alert>

        <v-alert
          v-if="message"
          type="success"
          dense
          text
        >
          {{ message }}
        </v-alert>

        <v-row>
          <v-col cols="12" md="6">
            <v-checkbox
              v-model="showErrorSource"
              label="Show source file and line number for reported errors"
              hint="Always enabled. Debug firmware reports file where the error came from."
              persistent-hint
              readonly
              disabled
            />
          </v-col>
        </v-row>

        <v-divider class="my-4" />

        <div class="text-subtitle-1 mb-1">Send running G-code debug output to</div>
        <div class="text-caption grey--text mb-2">
          Controls <code>global.debugGCode</code>. Pick any combination of destinations;
          with none selected, debug echo is turned off. If the variable is missing, the
          plugin creates it automatically.
        </div>

        <v-row>
          <v-col cols="12" sm="4">
            <v-checkbox
              v-model="dest.usb"
              label="USB (ACM serial)"
              :disabled="busy"
              hide-details
              @change="applyDestinations"
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-checkbox
              v-model="dest.telnet"
              label="Telnet"
              :disabled="busy"
              hide-details
              @change="applyDestinations"
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-checkbox
              v-model="dest.dwc"
              label="DWC (web console)"
              :disabled="busy"
              hide-details
              @change="applyDestinations"
            />
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12" class="d-flex align-center">
            <v-btn
              :loading="busy"
              :disabled="busy"
              @click="refresh"
            >
              Refresh
            </v-btn>
          </v-col>
        </v-row>

        <v-simple-table dense>
          <tbody>
            <tr>
              <td class="font-weight-medium">Firmware variable</td>
              <td><code>global.debugGCode</code></td>
            </tr>
            <tr>
              <td class="font-weight-medium">Variable status</td>
              <td>{{ debugGCodeVariableExists ? 'Exists in Object Model' : 'Missing; treated as Off' }}</td>
            </tr>
            <tr>
              <td class="font-weight-medium">Active destinations</td>
              <td>{{ destinationSummary }}</td>
            </tr>
            <tr v-if="extras.length">
              <td class="font-weight-medium">Preserved options</td>
              <td><code>{{ extras.join(', ') }}</code></td>
            </tr>
            <tr>
              <td class="font-weight-medium">Firmware value written</td>
              <td><code>{{ firmwareValue }}</code></td>
            </tr>
          </tbody>
        </v-simple-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script>
'use strict'

// The firmware's global.debugGCode parser recognises destination keywords
// (off/usb/telnet/dwc, plus web|http and the legacy "both" = usb+dwc). Any
// other token is a metadata flag ("all", "stack", "pos", …); the plugin has no
// UI for those, so it preserves them untouched — a console-set "usb:all"
// survives toggling a destination here.

export default {
  data() {
    return {
      busy: false,
      error: '',
      message: '',
      showErrorSource: true,
      debugGCodeVariableExists: false,
      dest: {
        usb: false,
        telnet: false,
        dwc: false
      },
      // Non-destination tokens (metadata flags) carried through unchanged.
      extras: []
    }
  },

  computed: {
    destinationSummary() {
      const on = []
      if (this.dest.usb) on.push('USB')
      if (this.dest.telnet) on.push('Telnet')
      if (this.dest.dwc) on.push('DWC')
      return on.length ? on.join(' + ') : 'Off'
    },

    firmwareValue() {
      return `"${this.buildDebugGCodeString()}"`
    }
  },

  mounted() {
    this.refresh()
  },

  methods: {
    async applyDestinations() {
      this.clearStatus()
      this.busy = true

      try {
        await this.writeDebugGCodeValue()
        await this.refresh(false)
        this.message = `Debug output destinations: ${this.destinationSummary}`
      } catch (e) {
        this.error = this.formatError(e)
      } finally {
        this.busy = false
      }
    },

    // Build the string written to global.debugGCode from the current checkboxes.
    // No destination selected -> "off". Preserved metadata flags are re-appended.
    buildDebugGCodeString() {
      const parts = []
      if (this.dest.usb) { parts.push('usb') }
      if (this.dest.telnet) { parts.push('telnet') }
      if (this.dest.dwc) { parts.push('dwc') }

      if (parts.length === 0) {
        return 'off'
      }

      let result = parts.join('|')
      if (this.extras.length) {
        result += ':' + this.extras.join(',')
      }
      return result
    },

    async writeDebugGCodeValue() {
      const quotedValue = `"${this.buildDebugGCodeString()}"`

      // Do not use RRF meta-command conditionals over /rr_gcode.
      // They are macro-file commands, not reliable console/API commands.
      // Instead, decide from Object Model and use a one-command fallback.
      const primaryCommand = this.debugGCodeVariableExists
        ? `set global.debugGCode = ${quotedValue}`
        : `global debugGCode = ${quotedValue}`

      const fallbackCommand = this.debugGCodeVariableExists
        ? `global debugGCode = ${quotedValue}`
        : `set global.debugGCode = ${quotedValue}`

      try {
        await this.runGCode(primaryCommand)
      } catch (primaryError) {
        if (!this.isVariableRaceError(primaryError)) {
          throw primaryError
        }

        await this.runGCode(fallbackCommand)
      }
    },

    async refresh(showMessage = true) {
      this.clearStatus()
      this.busy = true

      try {
        const readResult = await this.readDebugGCodeFromObjectModel()
        this.debugGCodeVariableExists = readResult.exists

        const parsed = this.parseDebugGCode(readResult.value)
        this.dest = parsed.dest
        this.extras = parsed.extras

        if (showMessage) {
          this.message = `Current debug output destinations: ${this.destinationSummary}`
        }
      } catch (e) {
        this.error = this.formatError(e)
      } finally {
        this.busy = false
      }
    },

    async readDebugGCodeFromObjectModel() {
      const response = await fetch('/rr_model?key=global')

      if (!response.ok) {
        throw new Error(`rr_model HTTP ${response.status}`)
      }

      const data = await response.json()
      const globals = data && data.result ? data.result : {}
      const exists = Object.prototype.hasOwnProperty.call(globals, 'debugGCode')

      return {
        exists,
        value: exists ? globals.debugGCode : null
      }
    },

    // Split a global.debugGCode value into destination checkboxes + preserved
    // metadata tokens. Mirrors the firmware separators (| : + , ; space tab).
    // "off" (or no destination token) means every destination is unchecked.
    parseDebugGCode(raw) {
      const dest = { usb: false, telnet: false, dwc: false }
      const extras = []
      let off = false

      // Indexed loop (not for...of) on purpose: DWC 3.5.x's core-js does not
      // ship the iterator-helper polyfills that a for...of would pull in, and a
      // missing polyfill module aborts plugin start-up on that runtime.
      const tokens = this.tokenize(raw)
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        switch (token) {
          case 'off':
            off = true
            break
          case 'usb':
            dest.usb = true
            break
          case 'telnet':
            dest.telnet = true
            break
          case 'dwc':
          case 'web':
          case 'http':
            dest.dwc = true
            break
          case 'both':
            // Legacy alias from the old debug build: USB + DWC.
            dest.usb = true
            dest.dwc = true
            break
          default:
            extras.push(token)
        }
      }

      // "off" dominates in the firmware; clear destinations and drop the
      // now-meaningless metadata so a re-write produces a clean "off".
      if (off) {
        dest.usb = false
        dest.telnet = false
        dest.dwc = false
        extras.length = 0
      }

      return { dest, extras }
    },

    tokenize(raw) {
      if (raw === null || raw === undefined) {
        return []
      }
      // Build the token list with a plain loop rather than .filter(): under DWC
      // 3.5.x's core-js, .filter() pulls the es.iterator.* helper polyfills,
      // which are absent on that host and abort plugin start-up.
      const parts = String(raw).toLowerCase().split(/[|:+,;\s]+/)
      const tokens = []
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          tokens.push(parts[i])
        }
      }
      return tokens
    },

    async runGCode(gcode) {
      const response = await fetch(`/rr_gcode?gcode=${encodeURIComponent(gcode)}`)

      if (!response.ok) {
        throw new Error(`rr_gcode HTTP ${response.status}`)
      }

      const data = await response.json()
      const err = data && Object.prototype.hasOwnProperty.call(data, 'err') ? Number(data.err) : 0

      if (err !== 0) {
        const reply = await this.readReplySafely()
        const error = new Error(reply || `G-code failed: ${gcode}`)
        error.gcode = gcode
        error.reply = reply
        error.rrGcodeResponse = data
        throw error
      }

      return data
    },

    async readReplySafely() {
      try {
        const response = await fetch('/rr_reply')

        if (!response.ok) {
          return ''
        }

        return await response.text()
      } catch (e) {
        return ''
      }
    },

    isVariableRaceError(error) {
      const text = this.formatError(error).toLowerCase()

      return text.includes('debuggcode') && (
        text.includes('already exists') ||
        text.includes('does not exist') ||
        text.includes('unknown variable') ||
        text.includes('reached null object')
      )
    },

    clearStatus() {
      this.error = ''
      this.message = ''
    },

    formatError(e) {
      return e && e.message ? e.message : String(e)
    }
  }
}
</script>
