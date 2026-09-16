#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <aclapi.h>
#include <bcrypt.h>
#include <sddl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <winhttp.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstring>
#include <cstdint>
#include <cwchar>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "ws2_32.lib")

namespace fs = std::filesystem;

namespace {
constexpr wchar_t kAppName[] = L"Mansion Karaoke";
constexpr wchar_t kStateDirectoryName[] = L"Mansion Karaoke";
constexpr wchar_t kTokenFileName[] = L"party-token";
constexpr wchar_t kLogFileName[] = L"controller.log";
constexpr wchar_t kExtensionDirectoryName[] = L"firefox-extension";
constexpr wchar_t kControllerFileName[] = L"mansion-controller.exe";
constexpr wchar_t kFirefoxPage[] = L"about:debugging#/runtime/this-firefox";
constexpr wchar_t kWindowClass[] = L"MansionKaraokeHostWindow";
constexpr wchar_t kTokenAlphabet[] = L"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
constexpr wchar_t kPortText[] = L"3010";
constexpr INTERNET_PORT kControllerPort = 3010;
constexpr UINT_PTR kHealthTimer = 1;
constexpr UINT kHealthIntervalMs = 150;
constexpr unsigned int kHealthAttemptLimit = 40;

struct HandleCloser {
    void operator()(HANDLE value) const noexcept {
        if (value != nullptr && value != INVALID_HANDLE_VALUE) {
            CloseHandle(value);
        }
    }
};

template <typename Closer>
class UniqueResource {
public:
    UniqueResource() noexcept = default;
    explicit UniqueResource(HANDLE value) noexcept : value_(value) {}
    ~UniqueResource() { reset(); }
    UniqueResource(const UniqueResource&) = delete;
    UniqueResource& operator=(const UniqueResource&) = delete;
    UniqueResource(UniqueResource&& other) noexcept : value_(other.release()) {}
    UniqueResource& operator=(UniqueResource&& other) noexcept {
        if (this != &other) {
            reset(other.release());
        }
        return *this;
    }
    [[nodiscard]] HANDLE get() const noexcept { return value_; }
    [[nodiscard]] explicit operator bool() const noexcept {
        return value_ != nullptr && value_ != INVALID_HANDLE_VALUE;
    }
    [[nodiscard]] HANDLE release() noexcept {
        const HANDLE result = value_;
        value_ = nullptr;
        return result;
    }
    void reset(HANDLE value = nullptr) noexcept {
        if (*this) {
            Closer{}(value_);
        }
        value_ = value;
    }

private:
    HANDLE value_ = nullptr;
};

using UniqueHandle = UniqueResource<HandleCloser>;

class UniqueInternetHandle {
public:
    UniqueInternetHandle() noexcept = default;
    explicit UniqueInternetHandle(HINTERNET value) noexcept : value_(value) {}
    ~UniqueInternetHandle() {
        if (value_ != nullptr) {
            WinHttpCloseHandle(value_);
        }
    }
    UniqueInternetHandle(const UniqueInternetHandle&) = delete;
    UniqueInternetHandle& operator=(const UniqueInternetHandle&) = delete;
    [[nodiscard]] HINTERNET get() const noexcept { return value_; }
    [[nodiscard]] explicit operator bool() const noexcept { return value_ != nullptr; }

private:
    HINTERNET value_ = nullptr;
};

class WinsockSession {
public:
    WinsockSession() {
        WSADATA data{};
        const int result = WSAStartup(MAKEWORD(2, 2), &data);
        if (result != 0) {
            throw std::runtime_error("WSAStartup failed");
        }
        active_ = true;
    }
    ~WinsockSession() {
        if (active_) {
            WSACleanup();
        }
    }
    WinsockSession(const WinsockSession&) = delete;
    WinsockSession& operator=(const WinsockSession&) = delete;

private:
    bool active_ = false;
};

struct TokenResult {
    std::wstring value;
    std::string disposition;
};

struct PortResult {
    bool available = false;
    int error = 0;
};

struct ReadinessResult {
    bool authenticated = false;
    DWORD statusCode = 0;
    std::string roomId;
};

struct Paths {
    fs::path executable;
    fs::path executableDirectory;
    fs::path resources;
    fs::path controller;
    fs::path bundledExtension;
    fs::path bundledManifest;
    fs::path state;
    fs::path token;
    fs::path log;
    fs::path installedExtension;
    fs::path installedManifest;
};

struct AppState {
    HINSTANCE instance = nullptr;
    HWND window = nullptr;
    HWND status = nullptr;
    HWND token = nullptr;
    HWND url = nullptr;
    HWND extensionPath = nullptr;
    Paths paths{};
    std::wstring partyToken;
    UniqueHandle mutex;
    UniqueHandle job;
    UniqueHandle process;
    UniqueHandle thread;
    UniqueHandle log;
    ReadinessResult readinessObservation{};
    unsigned int readinessAttempts = 0;
    bool controllerReady = false;
    bool readinessTimedOut = false;
    bool shuttingDown = false;
};

AppState g_app;

enum ControlId : int {
    kCopyToken = 1001,
    kOpenPartyPage = 1002,
    kOpenFirefoxSetup = 1003,
    kRevealExtension = 1004,
};

[[noreturn]] void Fail(const std::string& message) {
    throw std::runtime_error(message);
}

class ProcThreadAttributeList {
public:
    ProcThreadAttributeList() {
        SIZE_T required = 0;
        InitializeProcThreadAttributeList(nullptr, 1, 0, &required);
        if (required == 0) {
            Fail("Could not size the process handle allowlist");
        }
        storage_.resize(required);
        list_ = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage_.data());
        if (!InitializeProcThreadAttributeList(list_, 1, 0, &required)) {
            list_ = nullptr;
            Fail("Could not initialize the process handle allowlist");
        }
    }
    ~ProcThreadAttributeList() {
        if (list_ != nullptr) {
            DeleteProcThreadAttributeList(list_);
        }
    }
    ProcThreadAttributeList(const ProcThreadAttributeList&) = delete;
    ProcThreadAttributeList& operator=(const ProcThreadAttributeList&) = delete;

    void AllowHandles(HANDLE* handles, size_t count) {
        if (!UpdateProcThreadAttribute(list_, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                       handles, sizeof(HANDLE) * count, nullptr, nullptr)) {
            Fail("Could not configure the process handle allowlist");
        }
    }

    [[nodiscard]] LPPROC_THREAD_ATTRIBUTE_LIST get() const noexcept { return list_; }

private:
    std::vector<BYTE> storage_;
    LPPROC_THREAD_ATTRIBUTE_LIST list_ = nullptr;
};

class ScopedInheritableHandle {
public:
    explicit ScopedInheritableHandle(HANDLE handle) : handle_(handle) {
        if (!SetHandleInformation(handle_, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
            Fail("Could not enable handle inheritance");
        }
    }
    ~ScopedInheritableHandle() {
        SetHandleInformation(handle_, HANDLE_FLAG_INHERIT, 0);
    }
    ScopedInheritableHandle(const ScopedInheritableHandle&) = delete;
    ScopedInheritableHandle& operator=(const ScopedInheritableHandle&) = delete;
    [[nodiscard]] HANDLE get() const noexcept { return handle_; }

private:
    HANDLE handle_ = nullptr;
};

class UniqueLocalAllocation {
public:
    explicit UniqueLocalAllocation(HLOCAL value = nullptr) noexcept : value_(value) {}
    ~UniqueLocalAllocation() {
        if (value_ != nullptr) {
            LocalFree(value_);
        }
    }
    UniqueLocalAllocation(const UniqueLocalAllocation&) = delete;
    UniqueLocalAllocation& operator=(const UniqueLocalAllocation&) = delete;
    [[nodiscard]] HLOCAL get() const noexcept { return value_; }

private:
    HLOCAL value_ = nullptr;
};

std::wstring GetEnvironmentValue(const wchar_t* name) {
    const DWORD needed = GetEnvironmentVariableW(name, nullptr, 0);
    if (needed == 0) {
        return {};
    }
    std::wstring value(static_cast<size_t>(needed), L'\0');
    const DWORD written = GetEnvironmentVariableW(name, value.data(), needed);
    if (written == 0 || written >= needed) {
        return {};
    }
    value.resize(static_cast<size_t>(written));
    return value;
}

fs::path ExecutablePath() {
    std::wstring buffer(512, L'\0');
    for (;;) {
        const DWORD capacity = static_cast<DWORD>(buffer.size());
        const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), capacity);
        if (length == 0) {
            Fail("GetModuleFileNameW failed");
        }
        if (length < capacity - 1) {
            buffer.resize(static_cast<size_t>(length));
            return fs::path(buffer);
        }
        buffer.resize(buffer.size() * 2U);
    }
}

fs::path LocalAppDataPath() {
    const std::wstring configured = GetEnvironmentValue(L"LOCALAPPDATA");
    if (!configured.empty()) {
        return fs::path(configured);
    }
    PWSTR raw = nullptr;
    const HRESULT result = SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &raw);
    if (FAILED(result) || raw == nullptr) {
        Fail("FOLDERID_LocalAppData could not be resolved");
    }
    const fs::path path(raw);
    CoTaskMemFree(raw);
    return path;
}

std::string WideToUtf8(std::wstring_view input) {
    if (input.empty()) {
        return {};
    }
    const int required = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
                                             static_cast<int>(input.size()), nullptr, 0, nullptr, nullptr);
    if (required <= 0) {
        Fail("UTF-8 conversion failed");
    }
    std::string output(static_cast<size_t>(required), '\0');
    const int written = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
                                            static_cast<int>(input.size()), output.data(), required,
                                            nullptr, nullptr);
    if (written != required) {
        Fail("UTF-8 conversion failed");
    }
    return output;
}

std::wstring Utf8ToWide(std::string_view input) {
    if (input.empty()) {
        return {};
    }
    const int required = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(),
                                             static_cast<int>(input.size()), nullptr, 0);
    if (required <= 0) {
        Fail("Invalid UTF-8 text");
    }
    std::wstring output(static_cast<size_t>(required), L'\0');
    const int written = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(),
                                            static_cast<int>(input.size()), output.data(), required);
    if (written != required) {
        Fail("UTF-8 conversion failed");
    }
    return output;
}

std::string JsonEscape(std::string_view input) {
    std::string output;
    for (const unsigned char character : input) {
        switch (character) {
        case '"': output += "\\\""; break;
        case '\\': output += "\\\\"; break;
        case '\b': output += "\\b"; break;
        case '\f': output += "\\f"; break;
        case '\n': output += "\\n"; break;
        case '\r': output += "\\r"; break;
        case '\t': output += "\\t"; break;
        default:
            if (character < 0x20U) {
                constexpr char digits[] = "0123456789abcdef";
                output += "\\u00";
                output.push_back(digits[(character >> 4U) & 0x0fU]);
                output.push_back(digits[character & 0x0fU]);
            } else {
                output.push_back(static_cast<char>(character));
            }
        }
    }
    return output;
}

std::string PathJson(const fs::path& path) {
    return JsonEscape(WideToUtf8(path.wstring()));
}

std::vector<BYTE> CurrentUserSid() {
    UniqueHandle token;
    HANDLE rawToken = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawToken)) {
        Fail("OpenProcessToken failed");
    }
    token.reset(rawToken);
    DWORD size = 0;
    GetTokenInformation(token.get(), TokenUser, nullptr, 0, &size);
    if (size == 0) {
        Fail("GetTokenInformation failed");
    }
    std::vector<BYTE> buffer(static_cast<size_t>(size));
    if (!GetTokenInformation(token.get(), TokenUser, buffer.data(), size, &size)) {
        Fail("GetTokenInformation failed");
    }
    const auto* user = reinterpret_cast<const TOKEN_USER*>(buffer.data());
    const DWORD sidLength = GetLengthSid(user->User.Sid);
    std::vector<BYTE> sid(static_cast<size_t>(sidLength));
    if (!CopySid(sidLength, sid.data(), user->User.Sid)) {
        Fail("CopySid failed");
    }
    return sid;
}

void ProtectForCurrentUser(const fs::path& path, bool directory) {
    std::vector<BYTE> sid = CurrentUserSid();
    EXPLICIT_ACCESSW access{};
    access.grfAccessPermissions = directory ? FILE_ALL_ACCESS : (FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE);
    access.grfAccessMode = SET_ACCESS;
    access.grfInheritance = directory ? (SUB_CONTAINERS_AND_OBJECTS_INHERIT) : NO_INHERITANCE;
    access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    access.Trustee.TrusteeType = TRUSTEE_IS_USER;
    access.Trustee.ptstrName = reinterpret_cast<LPWSTR>(sid.data());

    PACL acl = nullptr;
    const DWORD aclResult = SetEntriesInAclW(1, &access, nullptr, &acl);
    if (aclResult != ERROR_SUCCESS || acl == nullptr) {
        Fail("SetEntriesInAclW failed");
    }
    const DWORD securityResult = SetNamedSecurityInfoW(
        const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        nullptr, nullptr, acl, nullptr);
    LocalFree(acl);
    if (securityResult != ERROR_SUCCESS) {
        Fail("Could not protect per-user state ACL");
    }
}

bool HasProtectedDacl(const fs::path& path) {
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    PACL dacl = nullptr;
    const DWORD result = GetNamedSecurityInfoW(const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT,
                                               DACL_SECURITY_INFORMATION, nullptr, nullptr,
                                               &dacl, nullptr, &descriptor);
    if (result != ERROR_SUCCESS || descriptor == nullptr || dacl == nullptr) {
        if (descriptor != nullptr) {
            LocalFree(descriptor);
        }
        return false;
    }
    SECURITY_DESCRIPTOR_CONTROL control = 0;
    DWORD revision = 0;
    const BOOL queried = GetSecurityDescriptorControl(descriptor, &control, &revision);
    LocalFree(descriptor);
    return queried != FALSE && (control & SE_DACL_PROTECTED) != 0;
}

void EnsureStateDirectory(const fs::path& state) {
    std::error_code error;
    fs::create_directories(state, error);
    if (error) {
        Fail("Could not create LOCALAPPDATA state directory");
    }
    ProtectForCurrentUser(state, true);
}

std::string ReadFileBytes(const fs::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        return {};
    }
    return std::string(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
}

void WritePrivateFile(const fs::path& path, std::string_view content) {
    const fs::path temporary = path.wstring() + L".tmp";
    UniqueHandle file(CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                  FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!file) {
        Fail("Could not create private state file");
    }
    if (content.size() > static_cast<size_t>(MAXDWORD)) {
        Fail("Private state file is too large");
    }
    const DWORD expected = static_cast<DWORD>(content.size());
    DWORD written = 0;
    if (!WriteFile(file.get(), content.data(), expected, &written, nullptr) || written != expected) {
        Fail("Could not write private state file");
    }
    if (!FlushFileBuffers(file.get())) {
        Fail("Could not flush private state file");
    }
    file.reset();
    ProtectForCurrentUser(temporary, false);
    if (!MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(temporary.c_str());
        Fail("Could not replace private state file");
    }
    ProtectForCurrentUser(path, false);
}

bool IsPartyToken(std::wstring_view token) {
    if (token.size() != 8U) {
        return false;
    }
    return std::all_of(token.begin(), token.end(), [](wchar_t character) {
        return std::wstring_view(kTokenAlphabet).find(character) != std::wstring_view::npos;
    });
}

std::wstring GeneratePartyToken() {
    std::array<UCHAR, 8> bytes{};
    const NTSTATUS status = BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()),
                                            BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (status < 0) {
        Fail("BCryptGenRandom could not generate a secure party token");
    }
    std::wstring token;
    token.reserve(8);
    for (const UCHAR byte : bytes) {
        token.push_back(kTokenAlphabet[byte & 31U]);
    }
    return token;
}

TokenResult LoadOrCreateToken(const fs::path& tokenPath) {
    std::string existingBytes = ReadFileBytes(tokenPath);
    while (!existingBytes.empty() &&
           (existingBytes.back() == '\r' || existingBytes.back() == '\n' || existingBytes.back() == ' ' ||
            existingBytes.back() == '\t')) {
        existingBytes.pop_back();
    }
    if (!existingBytes.empty()) {
        try {
            const std::wstring existing = Utf8ToWide(existingBytes);
            if (IsPartyToken(existing)) {
                ProtectForCurrentUser(tokenPath, false);
                return {existing, "preserved"};
            }
        } catch (const std::exception&) {
            // Invalid legacy text is deliberately migrated below.
        }
    }
    const bool migrated = fs::exists(tokenPath);
    const std::wstring generated = GeneratePartyToken();
    WritePrivateFile(tokenPath, WideToUtf8(generated) + "\r\n");
    return {generated, migrated ? "migrated" : "created"};
}

std::string ManifestVersion(const fs::path& manifest) {
    const std::string source = ReadFileBytes(manifest);
    const std::string key = "\"version\"";
    size_t cursor = source.find(key);
    if (cursor == std::string::npos) {
        Fail("The bundled Firefox manifest has no version");
    }
    cursor = source.find(':', cursor + key.size());
    cursor = source.find('"', cursor);
    if (cursor == std::string::npos) {
        Fail("The bundled Firefox manifest version is invalid");
    }
    const size_t end = source.find('"', cursor + 1U);
    if (end == std::string::npos || end == cursor + 1U) {
        Fail("The bundled Firefox manifest version is invalid");
    }
    const std::string version = source.substr(cursor + 1U, end - cursor - 1U);
    if (!std::all_of(version.begin(), version.end(), [](unsigned char character) {
            return std::isalnum(character) != 0 || character == '.' || character == '-' || character == '_';
        })) {
        Fail("The bundled Firefox manifest version is unsafe");
    }
    return version;
}

fs::path InstallExtension(const Paths& paths) {
    if (!fs::is_regular_file(paths.bundledManifest)) {
        Fail("The bundled Firefox extension manifest.json is missing");
    }
    const fs::path destination = paths.state / kExtensionDirectoryName / Utf8ToWide(ManifestVersion(paths.bundledManifest));
    const fs::path temporary = destination.wstring() + L".installing";
    std::error_code error;
    fs::remove_all(temporary, error);
    error.clear();
    fs::create_directories(temporary.parent_path(), error);
    if (error) {
        Fail("Could not create the versioned extension directory");
    }
    fs::create_directories(temporary, error);
    if (error) {
        Fail("Could not create the extension staging directory");
    }
    for (fs::recursive_directory_iterator item(paths.bundledExtension, error), end;
         !error && item != end; item.increment(error)) {
        const fs::path relative = fs::relative(item->path(), paths.bundledExtension, error);
        if (error) {
            break;
        }
        const fs::path target = temporary / relative;
        if (item->is_directory(error)) {
            fs::create_directories(target, error);
        } else if (item->is_regular_file(error)) {
            fs::create_directories(target.parent_path(), error);
            if (!error) {
                fs::copy_file(item->path(), target, fs::copy_options::overwrite_existing, error);
            }
        }
    }
    if (error) {
        std::error_code cleanupError;
        fs::remove_all(temporary, cleanupError);
        Fail("Could not copy the Firefox extension");
    }
    fs::remove_all(destination, error);
    error.clear();
    fs::rename(temporary, destination, error);
    if (error) {
        fs::remove_all(temporary, error);
        Fail("Could not install the versioned Firefox extension copy");
    }
    return destination;
}

Paths ResolvePaths() {
    Paths paths{};
    paths.executable = ExecutablePath();
    paths.executableDirectory = paths.executable.parent_path();
    paths.resources = paths.executableDirectory / L"resources";
    paths.controller = paths.resources / kControllerFileName;
    paths.bundledExtension = paths.resources / kExtensionDirectoryName;
    paths.bundledManifest = paths.bundledExtension / L"manifest.json";
    paths.state = LocalAppDataPath() / kStateDirectoryName;
    paths.token = paths.state / kTokenFileName;
    paths.log = paths.state / kLogFileName;
    return paths;
}

std::wstring ConfiguredBindAddress() {
    const std::wstring configured = GetEnvironmentValue(L"KARAOKE_BIND");
    return configured.empty() ? L"0.0.0.0" : configured;
}

std::wstring ReadinessHost(std::wstring_view bindAddress) {
    if (bindAddress == L"0.0.0.0" || bindAddress == L"*") {
        return L"127.0.0.1";
    }
    if (bindAddress == L"::" || bindAddress == L"[::]") {
        return L"::1";
    }
    return std::wstring(bindAddress);
}

PortResult ProbeControllerPort() {
    WinsockSession winsock;
    ADDRINFOW hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_protocol = IPPROTO_TCP;
    hints.ai_flags = AI_PASSIVE;
    PADDRINFOW results = nullptr;
    const std::wstring bindAddress = ConfiguredBindAddress();
    const int lookup = GetAddrInfoW(bindAddress.c_str(), kPortText, &hints, &results);
    if (lookup != 0 || results == nullptr) {
        return {false, lookup};
    }
    int lastError = 0;
    bool addressInUse = false;
    bool available = false;
    for (PADDRINFOW address = results; address != nullptr; address = address->ai_next) {
        const SOCKET socketHandle = socket(address->ai_family, address->ai_socktype, address->ai_protocol);
        if (socketHandle == INVALID_SOCKET) {
            lastError = WSAGetLastError();
            continue;
        }
        const BOOL exclusive = TRUE;
        if (setsockopt(socketHandle, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
                       reinterpret_cast<const char*>(&exclusive),
                       static_cast<int>(sizeof(exclusive))) == SOCKET_ERROR) {
            lastError = WSAGetLastError();
            closesocket(socketHandle);
            continue;
        }
        if (bind(socketHandle, address->ai_addr, static_cast<int>(address->ai_addrlen)) == 0) {
            available = true;
            closesocket(socketHandle);
            break;
        }
        lastError = WSAGetLastError();
        addressInUse = addressInUse || lastError == WSAEADDRINUSE;
        closesocket(socketHandle);
    }
    FreeAddrInfoW(results);
    return {available, available ? 0 : (addressInUse ? WSAEADDRINUSE : lastError)};
}

std::string LowerAscii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
        return static_cast<char>(std::tolower(character));
    });
    return value;
}

std::string ClassifyControllerLog(const fs::path& logPath) {
    const std::string log = LowerAscii(ReadFileBytes(logPath));
    if (log.find("eaddrinuse") != std::string::npos ||
        log.find("address already in use") != std::string::npos ||
        (log.find("port") != std::string::npos && log.find("in use") != std::string::npos)) {
        return "address-in-use";
    }
    return "none";
}

UniqueHandle PrepareControllerLog(const fs::path& path, bool truncate) {
    const DWORD creation = truncate ? CREATE_ALWAYS : OPEN_ALWAYS;
    UniqueHandle log(CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE,
                                 FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr, creation,
                                 FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!log) {
        Fail("Could not open controller.log");
    }
    ProtectForCurrentUser(path, false);
    if (truncate) {
        SetFilePointer(log.get(), 0, nullptr, FILE_BEGIN);
        if (!SetEndOfFile(log.get())) {
            Fail("Could not truncate controller.log");
        }
    }
    return log;
}

std::wstring QuoteCommandArgument(std::wstring_view argument) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (const wchar_t character : argument) {
        if (character == L'\\') {
            ++slashes;
        } else if (character == L'"') {
            result.append(slashes * 2U + 1U, L'\\');
            result.push_back(L'"');
            slashes = 0;
        } else {
            result.append(slashes, L'\\');
            slashes = 0;
            result.push_back(character);
        }
    }
    result.append(slashes * 2U, L'\\');
    result.push_back(L'"');
    return result;
}

std::vector<wchar_t> BuildControllerEnvironment(std::wstring_view token) {
    struct CaseInsensitiveLess {
        bool operator()(const std::wstring& left, const std::wstring& right) const noexcept {
            return _wcsicmp(left.c_str(), right.c_str()) < 0;
        }
    };
    std::map<std::wstring, std::wstring, CaseInsensitiveLess> variables;
    LPWCH raw = GetEnvironmentStringsW();
    if (raw == nullptr) {
        Fail("GetEnvironmentStringsW failed");
    }
    for (const wchar_t* line = raw; *line != L'\0'; line += wcslen(line) + 1U) {
        const std::wstring entry(line);
        const size_t separator = entry.find(L'=', entry.empty() || entry.front() != L'=' ? 0U : 1U);
        if (separator != std::wstring::npos) {
            variables[entry.substr(0, separator)] = entry.substr(separator + 1U);
        }
    }
    FreeEnvironmentStringsW(raw);
    variables[L"KARAOKE_TOKEN"] = std::wstring(token);
    variables[L"KARAOKE_ROOM_ID"] = L"local";
    variables[L"PORT"] = kPortText;

    std::vector<wchar_t> block;
    for (const auto& [name, value] : variables) {
        const std::wstring entry = name + L"=" + value;
        block.insert(block.end(), entry.begin(), entry.end());
        block.push_back(L'\0');
    }
    block.push_back(L'\0');
    return block;
}

void StartController(AppState& app) {
    if (!fs::is_regular_file(app.paths.controller)) {
        Fail("The bundled karaoke controller is missing");
    }
    app.log = PrepareControllerLog(app.paths.log, true);
    app.job.reset(CreateJobObjectW(nullptr, nullptr));
    if (!app.job) {
        Fail("CreateJobObjectW failed");
    }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(app.job.get(), JobObjectExtendedLimitInformation,
                                 &limits, static_cast<DWORD>(sizeof(limits)))) {
        Fail("Could not configure controller Job Object");
    }

    SECURITY_ATTRIBUTES inheritAttributes{};
    inheritAttributes.nLength = sizeof(inheritAttributes);
    inheritAttributes.bInheritHandle = TRUE;
    UniqueHandle nullInput(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                       &inheritAttributes, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!nullInput) {
        Fail("Could not open NUL for controller input");
    }
    ScopedInheritableHandle inheritableLog(app.log.get());
    std::array<HANDLE, 2> inheritedHandles{{nullInput.get(), inheritableLog.get()}};
    ProcThreadAttributeList attributes;
    attributes.AllowHandles(inheritedHandles.data(), inheritedHandles.size());

    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    startup.StartupInfo.wShowWindow = SW_HIDE;
    startup.StartupInfo.hStdInput = nullInput.get();
    startup.StartupInfo.hStdOutput = inheritableLog.get();
    startup.StartupInfo.hStdError = inheritableLog.get();
    startup.lpAttributeList = attributes.get();
    PROCESS_INFORMATION process{};
    std::wstring command = QuoteCommandArgument(app.paths.controller.wstring());
    std::vector<wchar_t> commandBuffer(command.begin(), command.end());
    commandBuffer.push_back(L'\0');
    std::vector<wchar_t> environment = BuildControllerEnvironment(app.partyToken);
    const DWORD flags = CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT |
                        EXTENDED_STARTUPINFO_PRESENT;
    if (!CreateProcessW(app.paths.controller.c_str(), commandBuffer.data(), nullptr, nullptr, TRUE, flags,
                        environment.data(), app.paths.state.c_str(), &startup.StartupInfo, &process)) {
        Fail("CreateProcessW could not start the karaoke controller");
    }
    app.process.reset(process.hProcess);
    app.thread.reset(process.hThread);
    if (!AssignProcessToJobObject(app.job.get(), app.process.get())) {
        TerminateProcess(app.process.get(), 1);
        Fail("AssignProcessToJobObject failed");
    }
    if (ResumeThread(app.thread.get()) == static_cast<DWORD>(-1)) {
        TerminateJobObject(app.job.get(), 1);
        Fail("Could not resume the karaoke controller");
    }
}

std::string JsonStringField(std::string_view json, std::string_view field) {
    const std::string key = "\"" + std::string(field) + "\"";
    size_t cursor = json.find(key);
    if (cursor == std::string_view::npos) {
        return {};
    }
    cursor = json.find(':', cursor + key.size());
    if (cursor == std::string_view::npos) {
        return {};
    }
    cursor = json.find('"', cursor + 1U);
    if (cursor == std::string_view::npos) {
        return {};
    }
    std::string value;
    for (++cursor; cursor < json.size(); ++cursor) {
        const char character = json[cursor];
        if (character == '"') {
            return value;
        }
        if (character == '\\') {
            ++cursor;
            if (cursor >= json.size()) {
                return {};
            }
            const char escaped = json[cursor];
            switch (escaped) {
            case '"': value.push_back('"'); break;
            case '\\': value.push_back('\\'); break;
            case '/': value.push_back('/'); break;
            case 'b': value.push_back('\b'); break;
            case 'f': value.push_back('\f'); break;
            case 'n': value.push_back('\n'); break;
            case 'r': value.push_back('\r'); break;
            case 't': value.push_back('\t'); break;
            default: return {};
            }
        } else {
            value.push_back(character);
        }
    }
    return {};
}

bool ControllerReady(std::wstring_view token) {
    g_app.readinessObservation = {};
    ReadinessResult& result = g_app.readinessObservation;
    UniqueInternetHandle session(WinHttpOpen(L"Mansion Karaoke Host/0.1.1",
                                             WINHTTP_ACCESS_TYPE_NO_PROXY,
                                             WINHTTP_NO_PROXY_NAME,
                                             WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) {
        return false;
    }
    WinHttpSetTimeouts(session.get(), 250, 250, 250, 250);
    const std::wstring host = ReadinessHost(ConfiguredBindAddress());
    UniqueInternetHandle connection(WinHttpConnect(session.get(), host.c_str(), kControllerPort, 0));
    if (!connection) {
        return false;
    }
    UniqueInternetHandle request(WinHttpOpenRequest(connection.get(), L"GET", L"/status", nullptr,
                                                    WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0));
    if (!request) {
        return false;
    }
    const std::wstring headers = L"Authorization: Bearer " + std::wstring(token) + L"\r\n";
    if (!WinHttpSendRequest(request.get(), headers.c_str(), static_cast<DWORD>(headers.size()),
                            WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(request.get(), nullptr)) {
        return false;
    }
    DWORD size = sizeof(result.statusCode);
    if (!WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &result.statusCode, &size,
                            WINHTTP_NO_HEADER_INDEX)) {
        return false;
    }
    result.authenticated = result.statusCode == 200;
    std::string body;
    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request.get(), &available) || available == 0) {
            break;
        }
        if (available > 1024U * 1024U || body.size() > 1024U * 1024U - available) {
            return false;
        }
        const size_t offset = body.size();
        body.resize(offset + static_cast<size_t>(available));
        DWORD received = 0;
        if (!WinHttpReadData(request.get(), body.data() + offset, available, &received)) {
            body.resize(offset);
            return false;
        }
        body.resize(offset + static_cast<size_t>(received));
        if (received == 0) {
            break;
        }
    }
    result.roomId = JsonStringField(body, "roomId");
    return result.authenticated && result.statusCode == 200 && result.roomId == "local";
}

void SetStatus(const std::wstring& text) {
    if (g_app.status != nullptr) {
        SetWindowTextW(g_app.status, text.c_str());
    }
}

std::wstring PortConflictMessage() {
    return L"Port 3010 is already in use. Quit the other controller or app using that port, then reopen Mansion Karaoke.";
}

std::wstring PortProbeMessage(int error) {
    if (error == WSAEADDRNOTAVAIL || error == WSAHOST_NOT_FOUND || error == WSATYPE_NOT_FOUND) {
        return L"KARAOKE_BIND is not a valid local bind configuration (error " +
               std::to_wstring(error) + L").";
    }
    return L"Windows could not verify the controller socket (error " + std::to_wstring(error) +
           L"). Check KARAOKE_BIND and your network configuration.";
}

void StopController() {
    if (g_app.shuttingDown) {
        return;
    }
    g_app.shuttingDown = true;
    if (g_app.job) {
        TerminateJobObject(g_app.job.get(), 0);
    }
    if (g_app.process) {
        WaitForSingleObject(g_app.process.get(), 2000);
    }
    g_app.thread.reset();
    g_app.process.reset();
    g_app.job.reset();
    g_app.log.reset();
}

HWND AddStatic(HWND parent, const wchar_t* text, int x, int y, int width, int height, DWORD style = 0) {
    return CreateWindowExW(0, L"STATIC", text, WS_CHILD | WS_VISIBLE | style,
                           x, y, width, height, parent, nullptr, g_app.instance, nullptr);
}

HWND AddReadOnly(HWND parent, const std::wstring& text, int x, int y, int width, int height) {
    return CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", text.c_str(),
                           WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL | ES_READONLY,
                           x, y, width, height, parent, nullptr, g_app.instance, nullptr);
}

HWND AddButton(HWND parent, const wchar_t* text, int id, int x, int y, int width) {
    return CreateWindowExW(0, L"BUTTON", text, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
                           x, y, width, 34, parent, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),
                           g_app.instance, nullptr);
}

std::optional<fs::path> FindFirefox() {
    const std::array<std::pair<HKEY, const wchar_t*>, 2> keys{{
        {HKEY_CURRENT_USER, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe"},
        {HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe"},
    }};
    constexpr std::array<DWORD, 2> views{{RRF_SUBKEY_WOW6464KEY, RRF_SUBKEY_WOW6432KEY}};
    for (const auto& [root, key] : keys) {
        for (const DWORD view : views) {
            wchar_t value[32768]{};
            DWORD size = sizeof(value);
            if (RegGetValueW(root, key, nullptr, RRF_RT_REG_SZ | view,
                             nullptr, value, &size) == ERROR_SUCCESS) {
                fs::path candidate(value);
                if (fs::is_regular_file(candidate)) {
                    return candidate;
                }
            }
        }
    }
    for (const wchar_t* variable : {L"ProgramFiles", L"ProgramFiles(x86)"}) {
        const std::wstring base = GetEnvironmentValue(variable);
        if (!base.empty()) {
            const fs::path candidate = fs::path(base) / L"Mozilla Firefox" / L"firefox.exe";
            if (fs::is_regular_file(candidate)) {
                return candidate;
            }
        }
    }
    const fs::path localCandidate = LocalAppDataPath() / L"Mozilla Firefox" / L"firefox.exe";
    if (fs::is_regular_file(localCandidate)) {
        return localCandidate;
    }
    return std::nullopt;
}

void CopyTokenToClipboard(HWND owner) {
    if (!OpenClipboard(owner)) {
        return;
    }
    EmptyClipboard();
    const size_t bytes = (g_app.partyToken.size() + 1U) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (memory != nullptr) {
        void* destination = GlobalLock(memory);
        if (destination != nullptr) {
            memcpy(destination, g_app.partyToken.c_str(), bytes);
            GlobalUnlock(memory);
            if (SetClipboardData(CF_UNICODETEXT, memory) != nullptr) {
                memory = nullptr;
                SetStatus(L"Party token copied to the clipboard.");
            }
        }
        if (memory != nullptr) {
            GlobalFree(memory);
        }
    }
    CloseClipboard();
}

void OpenPartyPage(HWND owner) {
    const HINSTANCE result = ShellExecuteW(owner, L"open", L"http://127.0.0.1:3010/", nullptr, nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(result) <= 32) {
        MessageBoxW(owner, L"Windows could not open the party page.", kAppName, MB_OK | MB_ICONERROR);
    }
}

void RevealManifest(HWND owner) {
    const std::wstring arguments = L"/select," + QuoteCommandArgument(g_app.paths.installedManifest.wstring());
    const HINSTANCE result = ShellExecuteW(owner, L"open", L"explorer.exe", arguments.c_str(), nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(result) <= 32) {
        MessageBoxW(owner, L"Windows could not reveal the extension manifest.", kAppName, MB_OK | MB_ICONERROR);
    }
}

void OpenFirefoxSetup(HWND owner) {
    const std::optional<fs::path> firefox = FindFirefox();
    if (!firefox.has_value()) {
        MessageBoxW(owner, L"Firefox was not found. Install Firefox, then try again.", kAppName,
                    MB_OK | MB_ICONWARNING);
        return;
    }
    std::wstring command = QuoteCommandArgument(firefox->wstring()) + L" --new-tab " + kFirefoxPage;
    std::vector<wchar_t> mutableCommand(command.begin(), command.end());
    mutableCommand.push_back(L'\0');
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(firefox->c_str(), mutableCommand.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr,
                        &startup, &process)) {
        MessageBoxW(owner, L"Firefox setup could not be opened.", kAppName, MB_OK | MB_ICONERROR);
        return;
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
}

void CheckReadiness(HWND window) {
    if (WaitForSingleObject(g_app.process.get(), 0) == WAIT_OBJECT_0) {
        KillTimer(window, kHealthTimer);
        g_app.log.reset();
        DWORD exitCode = 0;
        GetExitCodeProcess(g_app.process.get(), &exitCode);
        if (!g_app.controllerReady && ClassifyControllerLog(g_app.paths.log) == "address-in-use") {
            SetStatus(PortConflictMessage());
            MessageBoxW(window, PortConflictMessage().c_str(), L"Mansion Karaoke could not start",
                        MB_OK | MB_ICONERROR);
        } else {
            const wchar_t* timing = g_app.controllerReady ? L" unexpectedly" : L" early";
            SetStatus(L"Controller stopped" + std::wstring(timing) + L" (exit " +
                      std::to_wstring(exitCode) + L"). See controller.log for details.");
        }
        return;
    }
    if (g_app.controllerReady) {
        return;
    }
    if (ControllerReady(g_app.partyToken)) {
        g_app.controllerReady = true;
        SetStatus(L"Running — phones on this Wi-Fi can join from the TV QR code.");
        return;
    }
    ++g_app.readinessAttempts;
    if (g_app.readinessAttempts >= kHealthAttemptLimit && !g_app.readinessTimedOut) {
        g_app.readinessTimedOut = true;
        SetStatus(L"Controller started but did not become ready. See controller.log for details.");
    }
}

LRESULT CALLBACK WindowProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    (void)lParam;
    switch (message) {
    case WM_CREATE: {
        HFONT font = static_cast<HFONT>(GetStockObject(DEFAULT_GUI_FONT));
        AddStatic(window, L"Mansion Karaoke", 24, 18, 620, 36, SS_LEFT);
        g_app.status = AddStatic(window, L"Starting controller…", 24, 58, 620, 44, SS_LEFT);
        AddStatic(window, L"Controller URL", 24, 114, 120, 22);
        g_app.url = AddReadOnly(window, L"http://127.0.0.1:3010", 150, 110, 470, 26);
        AddStatic(window, L"Party token", 24, 154, 120, 22);
        g_app.token = AddReadOnly(window, g_app.partyToken, 150, 150, 470, 26);
        AddButton(window, L"Copy Token", kCopyToken, 24, 198, 130);
        AddButton(window, L"Open Party Page", kOpenPartyPage, 164, 198, 145);
        AddButton(window, L"Firefox Setup", kOpenFirefoxSetup, 319, 198, 130);
        AddButton(window, L"Reveal Extension", kRevealExtension, 459, 198, 161);
        AddStatic(window,
                  L"Firefox setup\r\n1. Reveal the extension and note manifest.json.\r\n"
                  L"2. Open Firefox Setup and choose Load Temporary Add-on.\r\n"
                  L"3. Select manifest.json, then enter the URL and token in the toolbar popup.\r\n"
                  L"4. Click Save & start. The temporary add-on must be reloaded after Firefox restarts.",
                  24, 252, 596, 118, SS_LEFT);
        g_app.extensionPath = AddReadOnly(window, g_app.paths.installedManifest.wstring(), 24, 386, 596, 27);
        EnumChildWindows(window, [](HWND child, LPARAM parameter) -> BOOL {
            SendMessageW(child, WM_SETFONT, static_cast<WPARAM>(parameter), TRUE);
            return TRUE;
        }, reinterpret_cast<LPARAM>(font));
        SetTimer(window, kHealthTimer, kHealthIntervalMs, nullptr);
        return 0;
    }
    case WM_COMMAND:
        switch (LOWORD(wParam)) {
        case kCopyToken: CopyTokenToClipboard(window); return 0;
        case kOpenPartyPage: OpenPartyPage(window); return 0;
        case kOpenFirefoxSetup: OpenFirefoxSetup(window); return 0;
        case kRevealExtension: RevealManifest(window); return 0;
        default: break;
        }
        break;
    case WM_TIMER:
        if (wParam == kHealthTimer) {
            CheckReadiness(window);
            return 0;
        }
        break;
    case WM_CLOSE:
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        KillTimer(window, kHealthTimer);
        StopController();
        PostQuitMessage(0);
        return 0;
    default:
        break;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

std::wstring CurrentUserMutexName() {
    const std::vector<BYTE> sid = CurrentUserSid();
    PSID sidPointer = const_cast<BYTE*>(sid.data());
    LPWSTR sidText = nullptr;
    if (!ConvertSidToStringSidW(sidPointer, &sidText) || sidText == nullptr) {
        Fail("Could not identify the current user for single-instance protection");
    }
    const std::wstring result = L"Global\\MansionKaraokeHost-" + std::wstring(sidText);
    LocalFree(sidText);
    return result;
}

UniqueHandle CreateCurrentUserMutex(const std::wstring& name, bool& alreadyExists) {
    std::vector<BYTE> sid = CurrentUserSid();
    EXPLICIT_ACCESSW access{};
    access.grfAccessPermissions = MUTEX_ALL_ACCESS;
    access.grfAccessMode = SET_ACCESS;
    access.grfInheritance = NO_INHERITANCE;
    access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    access.Trustee.TrusteeType = TRUSTEE_IS_USER;
    access.Trustee.ptstrName = reinterpret_cast<LPWSTR>(sid.data());

    PACL rawAcl = nullptr;
    const DWORD aclResult = SetEntriesInAclW(1, &access, nullptr, &rawAcl);
    if (aclResult != ERROR_SUCCESS || rawAcl == nullptr) {
        Fail("Could not create the single-instance mutex ACL");
    }
    UniqueLocalAllocation acl(reinterpret_cast<HLOCAL>(rawAcl));
    SECURITY_DESCRIPTOR descriptor{};
    if (!InitializeSecurityDescriptor(&descriptor, SECURITY_DESCRIPTOR_REVISION) ||
        !SetSecurityDescriptorDacl(&descriptor, TRUE, static_cast<PACL>(acl.get()), FALSE)) {
        Fail("Could not secure the single-instance mutex");
    }
    SECURITY_ATTRIBUTES attributes{};
    attributes.nLength = sizeof(attributes);
    attributes.lpSecurityDescriptor = &descriptor;
    attributes.bInheritHandle = FALSE;
    HANDLE mutex = CreateMutexW(&attributes, FALSE, name.c_str());
    alreadyExists = mutex != nullptr && GetLastError() == ERROR_ALREADY_EXISTS;
    return UniqueHandle(mutex);
}

bool HasArgument(int argc, wchar_t** argv, std::wstring_view argument, int& position) {
    for (int index = 1; index < argc; ++index) {
        if (argument == argv[index]) {
            position = index;
            return true;
        }
    }
    return false;
}

int RunSelfTest(const fs::path& outputPath) {
    Paths paths = ResolvePaths();
    EnsureStateDirectory(paths.state);
    const TokenResult token = LoadOrCreateToken(paths.token);
    const bool stateAcl = HasProtectedDacl(paths.state);
    const bool tokenAcl = HasProtectedDacl(paths.token);
    UniqueHandle log = PrepareControllerLog(paths.log, false);
    const bool logAcl = HasProtectedDacl(paths.log);
    log.reset();
    const std::string classification = ClassifyControllerLog(paths.log);
    const PortResult port = ProbeControllerPort();
    bool installed = false;
    try {
        paths.installedExtension = InstallExtension(paths);
        paths.installedManifest = paths.installedExtension / L"manifest.json";
        installed = fs::is_regular_file(paths.installedManifest);
    } catch (const std::exception&) {
        installed = false;
    }
    const bool controllerExists = fs::is_regular_file(paths.controller);
    const bool bundledManifestExists = fs::is_regular_file(paths.bundledManifest);
    const std::string json =
        std::string("{\n") +
        "  \"resources\": {\"root\": \"" + PathJson(paths.resources) +
        "\", \"controller\": \"" + PathJson(paths.controller) +
        "\", \"controllerExists\": " + (controllerExists ? "true" : "false") +
        ", \"extensionManifest\": \"" + PathJson(paths.bundledManifest) +
        "\", \"extensionManifestExists\": " + (bundledManifestExists ? "true" : "false") +
        ", \"installedManifest\": \"" + PathJson(paths.installedManifest) +
        "\", \"installedManifestExists\": " + (installed ? "true" : "false") + "},\n" +
        "  \"port\": {\"number\": 3010, \"available\": " + (port.available ? "true" : "false") +
        ", \"error\": " + std::to_string(port.error) + "},\n" +
        "  \"token\": {\"path\": \"" + PathJson(paths.token) +
        "\", \"valid\": " + (IsPartyToken(token.value) ? "true" : "false") +
        ", \"disposition\": \"" + token.disposition + "\"},\n" +
        "  \"acl\": {\"stateProtected\": " + (stateAcl ? "true" : "false") +
        ", \"tokenProtected\": " + (tokenAcl ? "true" : "false") +
        ", \"logProtected\": " + (logAcl ? "true" : "false") + "},\n" +
        "  \"log\": {\"path\": \"" + PathJson(paths.log) +
        "\", \"exists\": " + (fs::is_regular_file(paths.log) ? "true" : "false") + "},\n" +
        "  \"classification\": \"" + classification + "\"\n" +
        "}\n";
    std::ofstream output(outputPath, std::ios::binary | std::ios::trunc);
    if (!output) {
        Fail("Could not create --self-test-json output");
    }
    output.write(json.data(), static_cast<std::streamsize>(json.size()));
    output.close();
    if (!output) {
        Fail("Could not write --self-test-json output");
    }
    return controllerExists && bundledManifestExists && installed && stateAcl && tokenAcl && logAcl ? 0 : 1;
}

void WriteHostSmokeReport(const fs::path& outputPath, const ReadinessResult& readiness,
                          DWORD processId, std::string_view classification,
                          std::wstring_view message) {
    const std::string json =
        std::string("{\n") +
        "  \"readiness\": {\"authenticated\": " + (readiness.authenticated ? "true" : "false") +
        ", \"statusCode\": " + std::to_string(readiness.statusCode) +
        ", \"roomId\": \"" + JsonEscape(readiness.roomId) + "\"},\n" +
        "  \"controller\": {\"port\": 3010, \"pid\": " + std::to_string(processId) + "},\n" +
        "  \"classification\": \"" + JsonEscape(classification) + "\",\n" +
        "  \"message\": \"" + JsonEscape(WideToUtf8(message)) + "\"\n" +
        "}\n";
    std::ofstream output(outputPath, std::ios::binary | std::ios::trunc);
    if (!output) {
        Fail("Could not create --host-smoke-json output");
    }
    output.write(json.data(), static_cast<std::streamsize>(json.size()));
    output.close();
    if (!output) {
        Fail("Could not write --host-smoke-json output");
    }
}

int RunHostSmoke(const fs::path& outputPath) {
    ReadinessResult readiness{};
    DWORD processId = 0;
    std::string classification = "initialization-failed";
    std::wstring message = L"Launcher production initialization failed.";
    try {
        g_app.paths = ResolvePaths();
        EnsureStateDirectory(g_app.paths.state);
        const TokenResult token = LoadOrCreateToken(g_app.paths.token);
        g_app.partyToken = token.value;
        g_app.paths.installedExtension = InstallExtension(g_app.paths);
        g_app.paths.installedManifest = g_app.paths.installedExtension / L"manifest.json";

        classification = "port-probe-failed";
        const PortResult port = ProbeControllerPort();
        if (!port.available) {
            classification = port.error == WSAEADDRINUSE ? "address-in-use" : "port-probe-failed";
            message = port.error == WSAEADDRINUSE ? PortConflictMessage() : PortProbeMessage(port.error);
            WriteHostSmokeReport(outputPath, readiness, processId, classification, message);
            return 1;
        }

        classification = "start-failed";
        message = L"The controller process could not be started through the launcher.";
        StartController(g_app);
        processId = GetProcessId(g_app.process.get());
        if (processId == 0) {
            Fail("GetProcessId failed for the controller child");
        }

        classification = "readiness-timeout";
        message = L"The controller started but did not return authenticated HTTP 200 for room local before the readiness timeout.";
        for (unsigned int attempt = 0; attempt < kHealthAttemptLimit; ++attempt) {
            if (WaitForSingleObject(g_app.process.get(), 0) == WAIT_OBJECT_0) {
                g_app.log.reset();
                classification = ClassifyControllerLog(g_app.paths.log) == "address-in-use" ?
                                 "address-in-use" : "controller-exited";
                message = classification == "address-in-use" ? PortConflictMessage() :
                          L"The controller process exited before authenticated readiness. See controller.log for details.";
                break;
            }
            if (ControllerReady(g_app.partyToken)) {
                readiness = g_app.readinessObservation;
                classification = "none";
                message = L"The controller returned authenticated HTTP 200 for room local and was stopped cleanly.";
                break;
            }
            readiness = g_app.readinessObservation;
            Sleep(kHealthIntervalMs);
        }
        const bool succeeded = classification == "none";
        StopController();
        WriteHostSmokeReport(outputPath, readiness, processId, classification, message);
        return succeeded ? 0 : 1;
    } catch (const std::exception& error) {
        if (g_app.process && processId == 0) {
            processId = GetProcessId(g_app.process.get());
        }
        StopController();
        try {
            message = Utf8ToWide(error.what());
        } catch (const std::exception&) {
            message = L"The launcher failed while preparing or running the controller.";
        }
        WriteHostSmokeReport(outputPath, readiness, processId, classification, message);
        return 1;
    }
}

int RunGui(HINSTANCE instance, int showCommand) {
    g_app.instance = instance;
    g_app.paths = ResolvePaths();
    const std::wstring mutexName = CurrentUserMutexName();
    bool mutexAlreadyExists = false;
    g_app.mutex = CreateCurrentUserMutex(mutexName, mutexAlreadyExists);
    if (!g_app.mutex) {
        Fail("Could not create the single-instance mutex");
    }
    if (mutexAlreadyExists) {
        MessageBoxW(nullptr, L"Mansion Karaoke is already running for this user.", kAppName,
                    MB_OK | MB_ICONINFORMATION);
        return 0;
    }

    EnsureStateDirectory(g_app.paths.state);
    const TokenResult token = LoadOrCreateToken(g_app.paths.token);
    g_app.partyToken = token.value;
    g_app.paths.installedExtension = InstallExtension(g_app.paths);
    g_app.paths.installedManifest = g_app.paths.installedExtension / L"manifest.json";

    const PortResult port = ProbeControllerPort();
    if (!port.available) {
        const std::wstring message = port.error == WSAEADDRINUSE ? PortConflictMessage() :
                                     PortProbeMessage(port.error);
        MessageBoxW(nullptr, message.c_str(), L"Mansion Karaoke could not start",
                    MB_OK | MB_ICONERROR);
        return 1;
    }
    StartController(g_app);

    WNDCLASSEXW windowClass{};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.style = CS_HREDRAW | CS_VREDRAW;
    windowClass.lpfnWndProc = WindowProcedure;
    windowClass.hInstance = instance;
    windowClass.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(101));
    if (windowClass.hIcon == nullptr) {
        windowClass.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    }
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = reinterpret_cast<HBRUSH>(static_cast<INT_PTR>(COLOR_WINDOW + 1));
    windowClass.lpszClassName = kWindowClass;
    windowClass.hIconSm = windowClass.hIcon;
    if (RegisterClassExW(&windowClass) == 0) {
        Fail("Could not register the launcher window");
    }
    g_app.window = CreateWindowExW(0, kWindowClass, kAppName,
                                   WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
                                   CW_USEDEFAULT, CW_USEDEFAULT, 668, 470, nullptr, nullptr,
                                   instance, nullptr);
    if (g_app.window == nullptr) {
        Fail("Could not create the launcher window");
    }
    ShowWindow(g_app.window, showCommand);
    UpdateWindow(g_app.window);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return static_cast<int>(message.wParam);
}
} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int showCommand) {
    bool selfTestMode = false;
    bool hostSmokeMode = false;
    try {
        int argc = 0;
        wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
        if (argv == nullptr) {
            Fail("CommandLineToArgvW failed");
        }
        int selfTestPosition = -1;
        const bool selfTest = HasArgument(argc, argv, L"--self-test-json", selfTestPosition);
        selfTestMode = selfTest;
        int hostSmokePosition = -1;
        const bool hostSmoke = HasArgument(argc, argv, L"--host-smoke-json", hostSmokePosition);
        hostSmokeMode = hostSmoke;
        std::optional<fs::path> selfTestOutput;
        std::optional<fs::path> hostSmokeOutput;
        if (selfTest) {
            if (selfTestPosition + 1 >= argc) {
                LocalFree(argv);
                Fail("--self-test-json requires an output path");
            }
            selfTestOutput = fs::path(argv[selfTestPosition + 1]);
        }
        if (hostSmoke) {
            if (hostSmokePosition + 1 >= argc) {
                LocalFree(argv);
                Fail("--host-smoke-json requires an output path");
            }
            hostSmokeOutput = fs::path(argv[hostSmokePosition + 1]);
        }
        LocalFree(argv);
        if (hostSmokeOutput.has_value()) {
            return RunHostSmoke(*hostSmokeOutput);
        }
        if (selfTestOutput.has_value()) {
            return RunSelfTest(*selfTestOutput);
        }
        return RunGui(instance, showCommand);
    } catch (const std::exception& error) {
        StopController();
        if (!selfTestMode && !hostSmokeMode) {
            const std::wstring message =
                L"Mansion Karaoke could not start.\r\n\r\n" + Utf8ToWide(error.what());
            MessageBoxW(nullptr, message.c_str(), kAppName, MB_OK | MB_ICONERROR);
        }
        return 1;
    }
}
