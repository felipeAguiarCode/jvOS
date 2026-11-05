//! Live system meters for the desktop widgets and jv_ide: CPU, GPU, RAM, virtual memory, disk
//! space, the Wi-Fi signal and network throughput, read straight from Win32 (kernel32, pdh,
//! wlanapi, iphlpapi) without extra crates.

use std::collections::HashMap;

use serde::Serialize;

/// Bytes in use out of a total.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Usage {
    pub used: u64,
    pub total: u64,
}

/// A fixed drive ("C:") and its space.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Disk {
    pub name: String,
    #[serde(flatten)]
    pub usage: Usage,
}

/// The connected Wi-Fi network.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Wlan {
    /// Signal quality, 0..1.
    pub signal: f64,
    pub ssid: String,
}

/// Network throughput, in bytes per second.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Net {
    pub down: f64,
    pub up: f64,
}

/// One reading of every meter; a meter the machine cannot report is `None`.
#[derive(Clone, Debug, Default, Serialize)]
pub struct SystemStats {
    /// Share of CPU time busy since the previous reading, 0..1.
    pub cpu: Option<f64>,
    /// 3D engine utilisation since the previous reading, 0..1.
    pub gpu: Option<f64>,
    pub ram: Option<Usage>,
    /// Committed memory (RAM + page file) against the commit limit.
    pub memory: Option<Usage>,
    pub disks: Vec<Disk>,
    /// None without a Wi-Fi adapter or a connection.
    pub wlan: Option<Wlan>,
    /// Since the previous reading (None on the first one).
    pub net: Option<Net>,
}

/// Busy share between two `(idle, total)` CPU time readings.
fn busy_share(before: (u64, u64), after: (u64, u64)) -> Option<f64> {
    let idle = after.0.saturating_sub(before.0);
    let total = after.1.saturating_sub(before.1);
    (total > 0).then(|| (1.0 - idle as f64 / total as f64).clamp(0.0, 1.0))
}

/// Bytes received and sent per second between two readings of each interface's counters (keyed
/// by interface). An interface that just appeared counts nothing; a counter that went back (a
/// reset) counts nothing either.
fn throughput(before: &HashMap<u64, (u64, u64)>, after: &HashMap<u64, (u64, u64)>, seconds: f64) -> Option<Net> {
    if seconds <= 0.0 {
        return None;
    }
    let (down, up) = after.iter().fold((0u64, 0u64), |(down, up), (interface, (received, sent))| match before.get(interface) {
        Some((was_received, was_sent)) => (down + received.saturating_sub(*was_received), up + sent.saturating_sub(*was_sent)),
        None => (down, up),
    });
    Some(Net { down: down as f64 / seconds, up: up as f64 / seconds })
}

#[cfg(windows)]
pub use win::{disk_of, process_memory, Sampler};

#[cfg(windows)]
mod win {
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::path::Path;
    use std::ptr::{addr_of, null, null_mut};
    use std::time::{Duration, Instant};

    use super::{busy_share, throughput, Disk, SystemStats, Usage, Wlan};

    const DRIVE_FIXED: u32 = 3;
    const PDH_FMT_DOUBLE: u32 = 0x0000_0200;
    const PDH_MORE_DATA: u32 = 0x8000_07D2;
    const PDH_CSTATUS_VALID_DATA: u32 = 0;
    const PDH_CSTATUS_NEW_DATA: u32 = 1;
    /// Every process's use of every 3D engine; their sum is what Task Manager shows for the GPU.
    const GPU_COUNTER: &str = r"\GPU Engine(*engtype_3D)\Utilization Percentage";
    const WLAN_CLIENT_VERSION: u32 = 2;
    const WLAN_CONNECTED: u32 = 1;
    const WLAN_OPCODE_CURRENT_CONNECTION: u32 = 7;
    const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
    const IF_OPER_STATUS_UP: u32 = 1;
    /// InterfaceAndOperStatusFlags: a physical adapter, and not a filter on top of one (WFP, QoS),
    /// which would count the same traffic again.
    const HARDWARE_INTERFACE: u8 = 0x1;
    const FILTER_INTERFACE: u8 = 0x2;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    /// PROCESS_MEMORY_COUNTERS.
    #[repr(C)]
    #[derive(Default)]
    struct ProcessMemoryCounters {
        size: u32,
        page_faults: u32,
        peak_working_set: usize,
        working_set: usize,
        quota_peak_paged_pool: usize,
        quota_paged_pool: usize,
        quota_peak_non_paged_pool: usize,
        quota_non_paged_pool: usize,
        pagefile: usize,
        peak_pagefile: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    impl FileTime {
        fn ticks(self) -> u64 {
            (u64::from(self.high) << 32) | u64::from(self.low)
        }
    }

    #[repr(C)]
    #[derive(Default)]
    struct MemoryStatusEx {
        length: u32,
        load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    /// PDH_FMT_COUNTERVALUE_ITEM_W read as a double.
    #[repr(C)]
    struct PdhItem {
        name: *mut u16,
        status: u32,
        value: f64,
    }

    #[repr(C)]
    struct WlanInterfaceInfo {
        guid: [u8; 16],
        description: [u16; 256],
        state: u32,
    }

    #[repr(C)]
    struct WlanInterfaceList {
        count: u32,
        index: u32,
        items: [WlanInterfaceInfo; 1],
    }

    /// The start of WLAN_CONNECTION_ATTRIBUTES, up to the signal quality.
    #[repr(C)]
    struct WlanConnection {
        state: u32,
        mode: u32,
        profile: [u16; 256],
        ssid_length: u32,
        ssid: [u8; 32],
        bss_type: u32,
        bssid: [u8; 6],
        phy_type: u32,
        phy_index: u32,
        signal_quality: u32,
    }

    /// MIB_IF_ROW2, all of it (GetIfTable2 hands out an array of them).
    #[repr(C)]
    struct IfRow2 {
        luid: u64,
        index: u32,
        guid: [u8; 16],
        alias: [u16; 257],
        description: [u16; 257],
        physical_length: u32,
        physical: [u8; 32],
        permanent_physical: [u8; 32],
        mtu: u32,
        if_type: u32,
        tunnel_type: u32,
        media_type: u32,
        physical_medium: u32,
        access_type: u32,
        direction: u32,
        flags: u8,
        oper_status: u32,
        admin_status: u32,
        media_connect: u32,
        network_guid: [u8; 16],
        connection_type: u32,
        transmit_speed: u64,
        receive_speed: u64,
        in_octets: u64,
        in_other: [u64; 8],
        out_octets: u64,
        out_other: [u64; 8],
    }

    const _: () = assert!(size_of::<IfRow2>() == 1352);

    /// MIB_IF_TABLE2: the count, then the rows (8-byte aligned).
    #[repr(C)]
    struct IfTable2 {
        count: u32,
        rows: [IfRow2; 1],
    }

    #[link(name = "iphlpapi")]
    unsafe extern "system" {
        fn GetIfTable2(table: *mut *mut IfTable2) -> u32;
        fn FreeMibTable(memory: *const c_void);
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
        fn GetLogicalDrives() -> u32;
        fn GetDriveTypeW(root: *const u16) -> u32;
        fn GetDiskFreeSpaceExW(directory: *const u16, available: *mut u64, total: *mut u64, free: *mut u64) -> i32;
        fn GetVolumePathNameW(path: *const u16, volume: *mut u16, length: u32) -> i32;
        fn OpenProcess(access: u32, inherit: i32, id: u32) -> isize;
        fn K32GetProcessMemoryInfo(process: isize, counters: *mut ProcessMemoryCounters, size: u32) -> i32;
        fn CloseHandle(handle: isize) -> i32;
    }

    #[link(name = "pdh")]
    unsafe extern "system" {
        fn PdhOpenQueryW(source: *const u16, user: usize, query: *mut isize) -> u32;
        fn PdhAddEnglishCounterW(query: isize, path: *const u16, user: usize, counter: *mut isize) -> u32;
        fn PdhCollectQueryData(query: isize) -> u32;
        fn PdhGetFormattedCounterArrayW(counter: isize, format: u32, size: *mut u32, count: *mut u32, items: *mut PdhItem) -> u32;
        fn PdhCloseQuery(query: isize) -> u32;
    }

    #[link(name = "wlanapi")]
    unsafe extern "system" {
        fn WlanOpenHandle(version: u32, reserved: *const c_void, negotiated: *mut u32, handle: *mut isize) -> u32;
        fn WlanCloseHandle(handle: isize, reserved: *const c_void) -> u32;
        fn WlanEnumInterfaces(handle: isize, reserved: *const c_void, list: *mut *mut WlanInterfaceList) -> u32;
        fn WlanQueryInterface(
            handle: isize,
            guid: *const [u8; 16],
            opcode: u32,
            reserved: *const c_void,
            size: *mut u32,
            data: *mut *mut c_void,
            kind: *mut u32,
        ) -> u32;
        fn WlanFreeMemory(memory: *const c_void);
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    /// `(idle, kernel + user)` CPU time, in 100 ns ticks (kernel time includes idle).
    fn cpu_times() -> Option<(u64, u64)> {
        let (mut idle, mut kernel, mut user) = (FileTime::default(), FileTime::default(), FileTime::default());
        (unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0).then(|| (idle.ticks(), kernel.ticks() + user.ticks()))
    }

    /// Physical memory and committed memory.
    fn memory() -> Option<(Usage, Usage)> {
        let mut status = MemoryStatusEx { length: size_of::<MemoryStatusEx>() as u32, ..Default::default() };
        if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
            return None;
        }
        let ram = Usage { used: status.total_phys - status.avail_phys, total: status.total_phys };
        let commit = Usage { used: status.total_page_file - status.avail_page_file, total: status.total_page_file };
        Some((ram, commit))
    }

    /// Received and sent bytes so far, per physical interface that is up.
    fn net_counters() -> Option<HashMap<u64, (u64, u64)>> {
        let mut table: *mut IfTable2 = null_mut();
        if unsafe { GetIfTable2(&mut table) } != 0 || table.is_null() {
            return None;
        }
        let counters = unsafe {
            let first = addr_of!((*table).rows).cast::<IfRow2>();
            std::slice::from_raw_parts(first, (*table).count as usize)
                .iter()
                .filter(|row| {
                    row.flags & HARDWARE_INTERFACE != 0
                        && row.flags & FILTER_INTERFACE == 0
                        && row.oper_status == IF_OPER_STATUS_UP
                        && row.if_type != IF_TYPE_SOFTWARE_LOOPBACK
                })
                .map(|row| (row.luid, (row.in_octets, row.out_octets)))
                .collect()
        };
        unsafe { FreeMibTable(table.cast()) };
        Some(counters)
    }

    /// The RAM a process holds (its working set, what Task Manager shows), in bytes.
    pub fn process_memory(id: u32) -> Option<u64> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id) };
        if process == 0 {
            return None;
        }
        let mut counters = ProcessMemoryCounters { size: size_of::<ProcessMemoryCounters>() as u32, ..Default::default() };
        let read = unsafe { K32GetProcessMemoryInfo(process, &mut counters, counters.size) } != 0;
        unsafe { CloseHandle(process) };
        read.then_some(counters.working_set as u64)
    }

    /// The volume `path` is on (a drive, a share, a folder-mounted volume) and its space.
    pub fn disk_of(path: &Path) -> Option<Disk> {
        use std::os::windows::ffi::OsStrExt;
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut volume = vec![0u16; 1024];
        if unsafe { GetVolumePathNameW(path.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) } == 0 {
            return None;
        }
        let (mut available, mut total, mut free) = (0u64, 0u64, 0u64);
        if unsafe { GetDiskFreeSpaceExW(volume.as_ptr(), &mut available, &mut total, &mut free) } == 0 || total == 0 {
            return None;
        }
        let end = volume.iter().position(|&unit| unit == 0).unwrap_or(volume.len());
        let root = String::from_utf16_lossy(&volume[..end]);
        // "C:\" is shown as "C:", like the meters do.
        let name = root.trim_end_matches('\\');
        Some(Disk { name: if name.is_empty() { root.clone() } else { name.to_string() }, usage: Usage { used: total - free, total } })
    }

    fn disks() -> Vec<Disk> {
        let mask = unsafe { GetLogicalDrives() };
        (0..26u8)
            .filter(|bit| mask & (1 << bit) != 0)
            .filter_map(|bit| {
                let name = format!("{}:", char::from(b'A' + bit));
                let root = wide(&format!("{name}\\"));
                if unsafe { GetDriveTypeW(root.as_ptr()) } != DRIVE_FIXED {
                    return None;
                }
                let (mut available, mut total, mut free) = (0u64, 0u64, 0u64);
                let read = unsafe { GetDiskFreeSpaceExW(root.as_ptr(), &mut available, &mut total, &mut free) } != 0;
                (read && total > 0).then(|| Disk { name, usage: Usage { used: total - free, total } })
            })
            .collect()
    }

    /// A PDH query on the GPU engines; a rate counter, so each reading covers the time since the last.
    struct Gpu {
        query: isize,
        counter: isize,
    }

    impl Gpu {
        fn open() -> Option<Self> {
            let mut query = 0;
            if unsafe { PdhOpenQueryW(null(), 0, &mut query) } != 0 {
                return None;
            }
            // Closed by Drop if the counter is missing (no GPU, or counters disabled).
            let mut gpu = Gpu { query, counter: 0 };
            let path = wide(GPU_COUNTER);
            if unsafe { PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut gpu.counter) } != 0 {
                return None;
            }
            unsafe { PdhCollectQueryData(query) };
            Some(gpu)
        }

        fn read(&self) -> Option<f64> {
            if unsafe { PdhCollectQueryData(self.query) } != 0 {
                return None;
            }
            let (mut size, mut count) = (0u32, 0u32);
            let status = unsafe { PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, null_mut()) };
            if status != PDH_MORE_DATA {
                // No engine in use by any process.
                return (status == 0).then_some(0.0);
            }
            // The items, then their names: a u64 buffer keeps the doubles aligned.
            let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
            let items = buffer.as_mut_ptr().cast::<PdhItem>();
            if unsafe { PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, items) } != 0 {
                return None;
            }
            let items = unsafe { std::slice::from_raw_parts(items, count as usize) };
            let percent: f64 = items
                .iter()
                .filter(|item| matches!(item.status, PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA))
                .map(|item| item.value)
                .sum();
            Some((percent / 100.0).clamp(0.0, 1.0))
        }
    }

    impl Drop for Gpu {
        fn drop(&mut self) {
            unsafe { PdhCloseQuery(self.query) };
        }
    }

    /// The first connected Wi-Fi interface's network.
    fn wlan(handle: isize) -> Option<Wlan> {
        let mut list: *mut WlanInterfaceList = null_mut();
        if unsafe { WlanEnumInterfaces(handle, null(), &mut list) } != 0 || list.is_null() {
            return None;
        }
        let found = unsafe {
            let first = addr_of!((*list).items).cast::<WlanInterfaceInfo>();
            std::slice::from_raw_parts(first, (*list).count as usize)
                .iter()
                .filter(|item| item.state == WLAN_CONNECTED)
                .find_map(|item| {
                    let (mut size, mut data, mut kind) = (0u32, null_mut::<c_void>(), 0u32);
                    let status = WlanQueryInterface(handle, &item.guid, WLAN_OPCODE_CURRENT_CONNECTION, null(), &mut size, &mut data, &mut kind);
                    if status != 0 || data.is_null() {
                        return None;
                    }
                    let connection = &*data.cast::<WlanConnection>();
                    let length = (connection.ssid_length as usize).min(connection.ssid.len());
                    let network = Wlan {
                        signal: f64::from(connection.signal_quality.min(100)) / 100.0,
                        ssid: String::from_utf8_lossy(&connection.ssid[..length]).into_owned(),
                    };
                    WlanFreeMemory(data);
                    Some(network)
                })
        };
        unsafe { WlanFreeMemory(list.cast()) };
        found
    }

    /// Without the WLAN service (a desktop on cable) opening the handle fails: tried again this often.
    const WLAN_RETRY: Duration = Duration::from_secs(60);
    /// Free space barely moves between two readings two seconds apart.
    const DISKS_EVERY: Duration = Duration::from_secs(30);

    /// Keeps what the rate meters compare against (CPU times, the GPU query), the Wi-Fi handle and
    /// the last drive list.
    pub struct Sampler {
        cpu: Option<(u64, u64)>,
        gpu: Option<Gpu>,
        wlan: Option<isize>,
        wlan_failed: Option<Instant>,
        disks: Option<(Instant, Vec<Disk>)>,
        net: Option<(Instant, HashMap<u64, (u64, u64)>)>,
    }

    impl Default for Sampler {
        fn default() -> Self {
            Self { cpu: cpu_times(), gpu: Gpu::open(), wlan: None, wlan_failed: None, disks: None, net: None }
        }
    }

    impl Sampler {
        pub fn read(&mut self) -> SystemStats {
            let now = cpu_times();
            let cpu = self.cpu.zip(now).and_then(|(before, after)| busy_share(before, after));
            if now.is_some() {
                self.cpu = now;
            }
            let (ram, memory) = memory().unzip();
            let counted = net_counters().map(|counters| (Instant::now(), counters));
            let net = match (&self.net, &counted) {
                (Some((then, before)), Some((now, after))) => throughput(before, after, now.duration_since(*then).as_secs_f64()),
                _ => None,
            };
            if counted.is_some() {
                self.net = counted;
            }
            if self.wlan.is_none() && self.wlan_failed.is_none_or(|at| at.elapsed() >= WLAN_RETRY) {
                let (mut version, mut handle) = (0u32, 0isize);
                if unsafe { WlanOpenHandle(WLAN_CLIENT_VERSION, null(), &mut version, &mut handle) } == 0 {
                    self.wlan = Some(handle);
                    self.wlan_failed = None;
                } else {
                    self.wlan_failed = Some(Instant::now());
                }
            }
            if self.disks.as_ref().is_none_or(|(at, _)| at.elapsed() >= DISKS_EVERY) {
                self.disks = Some((Instant::now(), disks()));
            }
            SystemStats {
                cpu,
                gpu: self.gpu.as_ref().and_then(Gpu::read),
                ram,
                memory,
                disks: self.disks.as_ref().map(|(_, list)| list.clone()).unwrap_or_default(),
                wlan: self.wlan.and_then(wlan),
                net,
            }
        }
    }

    impl Drop for Sampler {
        fn drop(&mut self) {
            if let Some(handle) = self.wlan {
                unsafe { WlanCloseHandle(handle, null()) };
            }
        }
    }
}

/// Other systems: no meters.
#[cfg(not(windows))]
#[derive(Default)]
pub struct Sampler;

#[cfg(not(windows))]
impl Sampler {
    pub fn read(&mut self) -> SystemStats {
        SystemStats::default()
    }
}

#[cfg(not(windows))]
pub fn disk_of(_: &std::path::Path) -> Option<Disk> {
    None
}

#[cfg(not(windows))]
pub fn process_memory(_: u32) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_share_is_the_non_idle_part_of_the_elapsed_time() {
        assert_eq!(busy_share((100, 1000), (150, 1100)), Some(0.5));
        assert_eq!(busy_share((100, 1000), (200, 1100)), Some(0.0));
        assert_eq!(busy_share((100, 1000), (100, 1000)), None);
    }

    #[test]
    fn throughput_counts_what_moved_per_second() {
        let before = HashMap::from([(1, (1000, 500)), (2, (50, 50))]);
        let after = HashMap::from([(1, (3000, 1500)), (2, (10, 60)), (3, (9999, 9999))]);
        // Interface 2's received counter went back (a reset): nothing; interface 3 is new: nothing.
        assert_eq!(throughput(&before, &after, 2.0), Some(Net { down: 1000.0, up: 505.0 }));
        assert_eq!(throughput(&before, &after, 0.0), None);
        assert_eq!(throughput(&HashMap::new(), &after, 1.0), Some(Net { down: 0.0, up: 0.0 }));
    }

    #[cfg(windows)]
    #[test]
    fn reads_a_process_ram() {
        let own = process_memory(std::process::id()).expect("this process");
        assert!(own > 1024 * 1024, "{own}");
        assert_eq!(process_memory(u32::MAX - 3), None);
    }

    #[cfg(windows)]
    #[test]
    fn reads_this_machine() {
        let mut sampler = Sampler::default();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let stats = sampler.read();
        let cpu = stats.cpu.expect("CPU times");
        assert!((0.0..=1.0).contains(&cpu));
        let ram = stats.ram.expect("physical memory");
        assert!(ram.total > 0 && ram.used <= ram.total);
        let memory = stats.memory.expect("commit charge");
        assert!(memory.total >= ram.total && memory.used <= memory.total);
        let system = stats.disks.iter().find(|disk| disk.name == "C:").expect("drive C:");
        assert!(system.usage.total > 0 && system.usage.used <= system.usage.total);
        if let Some(gpu) = stats.gpu {
            assert!((0.0..=1.0).contains(&gpu));
        }
        if let Some(network) = &stats.wlan {
            assert!((0.0..=1.0).contains(&network.signal));
        }
        // The first reading has nothing to compare with; the next one does.
        assert!(stats.net.is_none());
        std::thread::sleep(std::time::Duration::from_millis(200));
        let again = sampler.read();
        let net = again.net.expect("network counters");
        assert!(net.down >= 0.0 && net.up >= 0.0);
        let disk = disk_of(&std::env::temp_dir()).expect("the temp folder's volume");
        assert!(disk.name.ends_with(':') && disk.usage.total > 0, "{disk:?}");
        println!("{stats:?}\n{again:?}\n{disk:?}");
    }
}
