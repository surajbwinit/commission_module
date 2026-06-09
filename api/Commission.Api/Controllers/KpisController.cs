using System.Text.Json;
using Commission.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

[ApiController]
[Route("api/kpis")]
public class KpisController : ControllerBase
{
    private static readonly HashSet<string> ValidFormulaTypes = new() { "simple", "ratio", "growth", "team", "static" };
    private readonly IDb _db;
    public KpisController(IDb db) { _db = db; }

    private static bool ValidateFormula(string? formulaStr)
    {
        if (string.IsNullOrWhiteSpace(formulaStr)) return true;
        // Treat an empty object as "no formula" so legacy / placeholder rows
        // don't trip the validator when the user edits them.
        if (formulaStr.Trim() == "{}") return true;
        try
        {
            var doc = JsonDocument.Parse(formulaStr);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            if (!doc.RootElement.TryGetProperty("type", out var t)) return false;
            return ValidFormulaTypes.Contains(t.GetString() ?? "");
        }
        catch { return true; }
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? category)
    {
        var sql = "SELECT * FROM kpi_definitions WHERE is_active = TRUE" +
                  (category != null ? " AND category = @cat" : "") +
                  " ORDER BY category, name";
        return Ok(await _db.QueryDynamicAsync(sql, new { cat = category }));
    }

    [HttpGet("categories")]
    public async Task<IActionResult> Categories()
        => Ok(await _db.QueryAsync<string>(
            "SELECT DISTINCT category FROM kpi_definitions ORDER BY category"));

    [HttpGet("{uid}")]
    public async Task<IActionResult> Get(string uid)
    {
        var row = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM kpi_definitions WHERE uid = @uid", new { uid });
        if (row is null) return NotFound(new { error = "KPI not found" });
        var dict = (IDictionary<string, object?>)row;
        dict["applicable_roles"] = await _db.QueryAsync<string>(
            "SELECT role_uid FROM kpi_applicable_roles WHERE kpi_uid = @uid", new { uid });
        return Ok(dict);
    }

    public class CreateKpiDto
    {
        public string? Name { get; set; }
        public string? Code { get; set; }
        public string? Category { get; set; }
        public string? Description { get; set; }
        public string? Formula { get; set; }
        public string? Unit { get; set; }
        public string? Direction { get; set; }
        public string? OrgUid { get; set; }
        public List<string>? ApplicableRoleUids { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateKpiDto dto)
    {
        if (!ValidateFormula(dto.Formula))
            return BadRequest(new { error = "Invalid formula: must be valid JSON with a recognized type (simple, ratio, growth, team, static)" });

        // Pre-empt the unique-code violation with a friendlier message than
        // a raw Postgres error. Race-safe enough for a manual UI.
        if (!string.IsNullOrWhiteSpace(dto.Code))
        {
            var existing = await _db.QuerySingleOrDefaultAsync<string>(
                "SELECT uid FROM kpi_definitions WHERE code = @c", new { c = dto.Code });
            if (existing is not null)
                return Conflict(new { error = $"A KPI with code '{dto.Code}' already exists. Pick a different code." });
        }

        var uid = Guid.NewGuid().ToString();
        try
        {
            await _db.InTransactionAsync(async (c, t) =>
            {
                await _db.ExecuteAsync(@"
                    INSERT INTO kpi_definitions
                        (uid, org_uid, name, code, category, description, formula, unit, direction, source_system)
                    VALUES (@uid, @org, @name, @code, @category, @description, @formula::jsonb, @unit, @direction, 'manual')",
                    new {
                        uid, org = dto.OrgUid, dto.Name, dto.Code, dto.Category, dto.Description,
                        formula = string.IsNullOrWhiteSpace(dto.Formula) ? "{}" : dto.Formula,
                        unit = dto.Unit ?? "currency",
                        direction = dto.Direction ?? "higher_is_better"
                    }, t);
                foreach (var roleUid in dto.ApplicableRoleUids ?? new())
                    await _db.ExecuteAsync(@"
                        INSERT INTO kpi_applicable_roles (uid, kpi_uid, role_uid, source_system)
                        VALUES (@i, @k, @r, 'manual')",
                        new { i = Guid.NewGuid().ToString(), k = uid, r = roleUid }, t);
            });
        }
        catch (Npgsql.PostgresException pe) when (pe.SqlState == "23505")
        {
            return Conflict(new { error = "A KPI with this code already exists. Pick a different code." });
        }
        var kpi = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM kpi_definitions WHERE uid = @uid", new { uid });
        return StatusCode(201, kpi);
    }

    [HttpPut("{uid}")]
    public async Task<IActionResult> Update(string uid, [FromBody] CreateKpiDto dto)
    {
        var existing = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT uid FROM kpi_definitions WHERE uid = @uid", new { uid });
        if (existing is null) return NotFound(new { error = "KPI not found" });
        if (!ValidateFormula(dto.Formula))
            return BadRequest(new { error = "Invalid formula" });

        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync(@"
                UPDATE kpi_definitions SET
                    name = COALESCE(@name, name),
                    code = COALESCE(@code, code),
                    category = COALESCE(@category, category),
                    description = COALESCE(@description, description),
                    formula = COALESCE(@formula::jsonb, formula),
                    unit = COALESCE(@unit, unit),
                    direction = COALESCE(@direction, direction),
                    org_uid = COALESCE(@org, org_uid),
                    modified_time = NOW()
                WHERE uid = @uid",
                new {
                    uid, dto.Name, dto.Code, dto.Category, dto.Description, dto.Formula,
                    dto.Unit, dto.Direction, org = dto.OrgUid
                }, t);

            if (dto.ApplicableRoleUids != null)
            {
                await _db.ExecuteAsync(
                    "DELETE FROM kpi_applicable_roles WHERE kpi_uid = @uid", new { uid }, t);
                foreach (var roleUid in dto.ApplicableRoleUids)
                    await _db.ExecuteAsync(@"
                        INSERT INTO kpi_applicable_roles (uid, kpi_uid, role_uid, source_system)
                        VALUES (@i, @k, @r, 'manual')",
                        new { i = Guid.NewGuid().ToString(), k = uid, r = roleUid }, t);
            }
        });

        var updated = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM kpi_definitions WHERE uid = @uid", new { uid });
        return Ok(updated);
    }

    [HttpDelete("{uid}")]
    public async Task<IActionResult> Delete(string uid)
    {
        var existing = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT uid FROM kpi_definitions WHERE uid = @uid", new { uid });
        if (existing is null) return NotFound(new { error = "KPI not found" });
        await _db.ExecuteAsync(
            "UPDATE kpi_definitions SET is_active = FALSE, modified_time = NOW() WHERE uid = @uid",
            new { uid });
        return Ok(new { success = true });
    }
}
