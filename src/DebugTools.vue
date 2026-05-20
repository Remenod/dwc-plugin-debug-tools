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

        <v-row>
          <v-col cols="12" md="6">
            <v-select
              v-model="debugGCode"
              :items="debugGCodeItems"
              item-text="text"
              item-value="value"
              label="Running G-code console echo"
              hint="Controls global.debugGCode. If the variable is missing, the plugin creates it automatically."
              persistent-hint
              :disabled="busy"
              @change="applyDebugGCode"
            />
          </v-col>

          <v-col cols="12" md="6" class="d-flex align-center">
            <v-btn
              :loading="busy"
              :disabled="busy"
              @click="refreshDebugGCode"
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
              <td class="font-weight-medium">Current UI value</td>
              <td>{{ debugGCodeLabel }}</td>
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

export default {
  data() {
    return {
      busy: false,
      error: '',
      message: '',
      showErrorSource: true,
      debugGCode: 'off',
      debugGCodeVariableExists: false,
      debugGCodeItems: [
        {
          text: 'Off',
          value: 'off',
          firmwareValue: '"off"'
        },
        {
          text: 'USB ACM only',
          value: 'usb',
          firmwareValue: '"usb"'
        },
        {
          text: 'DWC console + USB ACM',
          value: 'both',
          firmwareValue: '"both"'
        }
      ]
    }
  },

  computed: {
    debugGCodeLabel() {
      const item = this.debugGCodeItems.find(entry => entry.value === this.debugGCode)
      return item ? item.text : this.debugGCode
    },

    firmwareValue() {
      const item = this.debugGCodeItems.find(entry => entry.value === this.debugGCode)
      return item ? item.firmwareValue : 'unknown'
    }
  },

  mounted() {
    this.refreshDebugGCode()
  },

  methods: {
    async applyDebugGCode() {
      this.clearStatus()
      this.busy = true

      try {
        await this.writeDebugGCodeValue(this.debugGCode)
        await this.refreshDebugGCode(false)
        this.message = `Running G-code console echo set to: ${this.debugGCodeLabel}`
      } catch (e) {
        this.error = this.formatError(e)
      } finally {
        this.busy = false
      }
    },

    async writeDebugGCodeValue(value) {
      const safeValue = this.normalizeDebugGCode(value)
      const quotedValue = `"${safeValue}"`

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

    async refreshDebugGCode(showMessage = true) {
      this.clearStatus()
      this.busy = true

      try {
        const readResult = await this.readDebugGCodeFromObjectModel()
        this.debugGCodeVariableExists = readResult.exists
        this.debugGCode = this.normalizeDebugGCode(readResult.value)

        if (showMessage) {
          this.message = `Current running G-code console echo: ${this.debugGCodeLabel}`
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
        value: exists ? globals.debugGCode : 'off'
      }
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

    normalizeDebugGCode(value) {
      if (value === null || value === undefined || value === '' || value === 'null' || value === 'off') {
        return 'off'
      }

      if (value === 'usb') {
        return 'usb'
      }

      if (value === 'both') {
        return 'both'
      }

      return 'off'
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
