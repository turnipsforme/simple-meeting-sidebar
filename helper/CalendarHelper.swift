import EventKit
import Foundation

private struct CalendarEventOutput: Codable {
    let id: String
    let title: String
    let start: Date
    let end: Date
    let allDay: Bool
    let calendar: String
    let hasGoogleMeet: Bool
    let location: String?
    let guests: [String]?
}

private enum HelperError: LocalizedError {
    case invalidArguments
    case calendarAccessDenied

    var errorDescription: String? {
        switch self {
        case .invalidArguments:
            return "Calendar helper expected an ISO-8601 start and end timestamp."
        case .calendarAccessDenied:
            return "Calendar access was denied. Allow Simple Meeting Sidebar in System Settings → Privacy & Security → Calendars, then refresh again."
        }
    }
}

@main
private struct CalendarHelper {
    static func main() async {
        do {
            if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--version" {
                print("calendar-helper 0.2.0")
                return
            }
            if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--self-test" {
                try runSelfTest()
                print("calendar-helper self-test passed")
                return
            }

            if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--list-calendars" {
                let store = EKEventStore()
                guard try await requestCalendarAccess(store: store) else {
                    throw HelperError.calendarAccessDenied
                }
                let calendars = store.calendars(for: .event)
                    .map(\.title)
                    .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
                try writeJSON(calendars)
                return
            }

            guard CommandLine.arguments.count == 3,
                  let start = parseISO8601(CommandLine.arguments[1]),
                  let end = parseISO8601(CommandLine.arguments[2]),
                  start < end else {
                throw HelperError.invalidArguments
            }

            let store = EKEventStore()
            guard try await requestCalendarAccess(store: store) else {
                throw HelperError.calendarAccessDenied
            }

            let calendars = store.calendars(for: .event)
            let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
            let events = store.events(matching: predicate)
                .map { event in
                    CalendarEventOutput(
                        id: event.eventIdentifier ?? event.calendarItemExternalIdentifier ?? "",
                        title: event.title ?? "Untitled event",
                        start: event.startDate,
                        end: event.endDate,
                        allDay: event.isAllDay,
                        calendar: event.calendar?.title ?? "",
                        hasGoogleMeet: hasGoogleMeetLink(event),
                        location: event.location,
                        guests: guestNames(event)
                    )
                }
                .sorted { left, right in
                    if left.allDay != right.allDay { return left.allDay }
                    if left.start != right.start { return left.start < right.start }
                    return left.title.localizedCaseInsensitiveCompare(right.title) == .orderedAscending
                }

            try writeJSON(events)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            writeStandardError("Simple Meeting Sidebar: \(message)\n")
            Foundation.exit(1)
        }
    }

    private static func requestCalendarAccess(store: EKEventStore) async throws -> Bool {
        if #available(macOS 14.0, *) {
            switch EKEventStore.authorizationStatus(for: .event) {
            case .fullAccess:
                return true
            case .notDetermined:
                return try await store.requestFullAccessToEvents()
            default:
                return false
            }
        }

        switch EKEventStore.authorizationStatus(for: .event) {
        case .authorized:
            return true
        case .notDetermined:
            return try await withCheckedThrowingContinuation { continuation in
                store.requestAccess(to: .event) { granted, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: granted)
                    }
                }
            }
        default:
            return false
        }
    }

    private static func parseISO8601(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    private static func guestNames(_ event: EKEvent) -> [String]? {
        let names = (event.attendees ?? []).compactMap { participant -> String? in
            let name = participant.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !name.isEmpty { return name }
            return nil
        }
        return names.isEmpty ? nil : names
    }

    private static func hasGoogleMeetLink(_ event: EKEvent) -> Bool {
        [event.url?.absoluteString, event.location, event.notes]
            .compactMap { $0?.lowercased() }
            .contains { $0.contains("meet.google.com") }
    }

    private static func writeJSON<Value: Encodable>(_ value: Value) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let encoded = try encoder.encode(value)
        FileHandle.standardOutput.write(encoded)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    private static func runSelfTest() throws {
        guard parseISO8601("2026-07-25T08:00:00.000Z") != nil,
              parseISO8601("2026-07-25T08:00:00Z") != nil,
              parseISO8601("not-a-date") == nil else {
            throw HelperError.invalidArguments
        }

        let fixture = [
            CalendarEventOutput(
                id: "self-test",
                title: "Test meeting",
                start: Date(timeIntervalSince1970: 0),
                end: Date(timeIntervalSince1970: 1800),
                allDay: false,
                calendar: "Test",
                hasGoogleMeet: true,
                location: nil,
                guests: nil
            )
        ]
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        _ = try encoder.encode(fixture)

        guard "https://meet.google.com/abc-defg-hij".lowercased().contains("meet.google.com") else {
            throw HelperError.invalidArguments
        }
    }

    private static func writeStandardError(_ value: String) {
        if let data = value.data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }
}
