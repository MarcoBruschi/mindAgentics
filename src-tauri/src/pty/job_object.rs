pub struct ProcessJobObject {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

impl ProcessJobObject {
    pub fn new() -> Self {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::JobObjects::*;
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle != 0 {
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
            }
            Self { handle }
        }

        #[cfg(not(windows))]
        Self {}
    }

    pub fn assign_process(&self, _pid: u32) {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::Threading::*;
            use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
            if self.handle != 0 {
                let proc_handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, _pid);
                if proc_handle != 0 {
                    AssignProcessToJobObject(self.handle, proc_handle);
                    windows_sys::Win32::Foundation::CloseHandle(proc_handle);
                }
            }
        }
    }
}

impl Drop for ProcessJobObject {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            if self.handle != 0 {
                windows_sys::Win32::Foundation::CloseHandle(self.handle);
            }
        }
    }
}
