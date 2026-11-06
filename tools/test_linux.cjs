// Actual Linux boot and shell integration test; run with `node tools/test_linux.cjs`.
const assert = require('node:assert/strict');
const path = require('node:path');
const { V86 } = require('../frontend/static/vendor/v86/libv86.js');
const base = path.resolve(__dirname, '../frontend/static');
const vm = new V86({
    wasm_path: path.join(base, 'vendor/v86/v86.wasm'),
    bios: { url: path.join(base, 'vendor/v86/seabios.bin') },
    vga_bios: { url: path.join(base, 'vendor/v86/vgabios.bin') },
    bzimage: { url: path.join(base, 'images/buildroot-linux.bin') },
    memory_size: 128 * 1024 * 1024,
    cmdline: 'console=ttyS0,115200 tsc=reliable mitigations=off random.trust_cpu=on',
    filesystem: {},
    autostart: true,
    disable_speaker: true,
});
let output = '', sent = false, finished = false;
const timeout = setTimeout(() => { console.error(output.slice(-4000)); process.exit(1); }, 120000);
vm.add_listener('serial0-output-byte', async byte => {
    output += String.fromCharCode(byte);
    if (!sent && !finished && /(?:~|\/)\s*[#%$] $/.test(output)) {
        sent = true;
        console.log('Linux shell booted. Testing actual programs and shared filesystem.');
        await vm.create_file('greenos-test.txt', new TextEncoder().encode('SHARED_FILE_OK'));
        vm.serial0_send("uname -s\ncat /mnt/greenos-test.txt; echo\nprintf 'GUEST_WRITE_OK' > /mnt/result.txt\necho TEST_COMPLETE\n");
    }
    if (sent && !finished && /\r?\nTEST_COMPLETE\r?\n/.test(output)) {
        finished = true;
        clearTimeout(timeout);
        try {
            assert.match(output, /\r?\nLinux\r?\n/);
            assert.match(output, /\r?\nSHARED_FILE_OK/);
            assert.equal(new TextDecoder().decode(await vm.read_file('result.txt')), 'GUEST_WRITE_OK');
            console.log('PASS: Linux kernel, shell commands, host → guest and guest → host files.');
            await vm.stop();
            const state = await vm.save_state();
            await vm.restore_state(state);
            console.log(`PASS: VM save/restore (${state.byteLength.toLocaleString()} bytes).`);
            await vm.destroy();
            process.exit(0);
        } catch (error) { console.error(error); process.exit(1); }
    }
});
