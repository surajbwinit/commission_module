using System.Data;
using Npgsql;
using Dapper;

namespace Commission.Api.Data;

/// <summary>
/// Connection factory + lightweight DB facade.
/// All access goes through Dapper — no Entity Framework. Raw SQL only.
/// Mirrors the JS getDb() shape so the calc engine port stays close to the original.
/// </summary>
public interface IDb
{
    Task<IDbConnection> OpenAsync(CancellationToken ct = default);
    Task<T?> QuerySingleOrDefaultAsync<T>(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default);
    Task<IEnumerable<T>> QueryAsync<T>(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default);
    Task<IEnumerable<dynamic>> QueryDynamicAsync(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default);
    Task<int> ExecuteAsync(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default);
    Task<T> InTransactionAsync<T>(Func<IDbConnection, IDbTransaction, Task<T>> work, CancellationToken ct = default);
    Task InTransactionAsync(Func<IDbConnection, IDbTransaction, Task> work, CancellationToken ct = default);
}

public class Db : IDb
{
    private readonly string _connectionString;
    public Db(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("Default")
            ?? Environment.GetEnvironmentVariable("DATABASE_URL")
            ?? throw new InvalidOperationException(
                "DATABASE_URL not set. Provide ConnectionStrings:Default in appsettings.json or DATABASE_URL env var.");
    }

    public async Task<IDbConnection> OpenAsync(CancellationToken ct = default)
    {
        var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        return conn;
    }

    public async Task<T?> QuerySingleOrDefaultAsync<T>(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default)
    {
        if (tx != null) return await tx.Connection!.QuerySingleOrDefaultAsync<T>(new CommandDefinition(sql, param, tx, cancellationToken: ct));
        using var conn = await OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<IEnumerable<T>> QueryAsync<T>(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default)
    {
        if (tx != null) return await tx.Connection!.QueryAsync<T>(new CommandDefinition(sql, param, tx, cancellationToken: ct));
        using var conn = await OpenAsync(ct);
        return await conn.QueryAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<IEnumerable<dynamic>> QueryDynamicAsync(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default)
    {
        if (tx != null) return await tx.Connection!.QueryAsync(new CommandDefinition(sql, param, tx, cancellationToken: ct));
        using var conn = await OpenAsync(ct);
        return await conn.QueryAsync(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<int> ExecuteAsync(string sql, object? param = null, IDbTransaction? tx = null, CancellationToken ct = default)
    {
        if (tx != null) return await tx.Connection!.ExecuteAsync(new CommandDefinition(sql, param, tx, cancellationToken: ct));
        using var conn = await OpenAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<T> InTransactionAsync<T>(Func<IDbConnection, IDbTransaction, Task<T>> work, CancellationToken ct = default)
    {
        using var conn = await OpenAsync(ct);
        using var tx = conn.BeginTransaction();
        try
        {
            var result = await work(conn, tx);
            tx.Commit();
            return result;
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    public async Task InTransactionAsync(Func<IDbConnection, IDbTransaction, Task> work, CancellationToken ct = default)
    {
        await InTransactionAsync<bool>(async (c, t) => { await work(c, t); return true; }, ct);
    }
}
